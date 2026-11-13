import { createInstructionBackup } from './instruction-backup.js';
import { createHistoryJsonBackup } from './history-backup.js';
import { normalizeLongDreamRecord } from './long-dream.js';
import { newHistoryKey, historyKey, orderedHistory } from './history-collections.js';
import { hashBytes } from './backup-hash.js';

export const BACKUP_FORMAT = 'st-theater-complete';
export const BACKUP_VERSION = 1;
export const BACKUP_MANIFEST = 'theater-backup.json';
export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
const list = value => Array.isArray(value) ? value : [];
const copy = value => JSON.parse(JSON.stringify(value));
const origins = value => list(value?.backupOrigins).filter(x => typeof x === 'string' && x.length < 250).slice(-100);
const good = value => value && !value.deleted && !value.discarded && !value.error && !['failed', 'error', 'discarded', 'deleted'].includes(value.status);
const hasContent = value => good(value) && (String(value.text || '').trim() || String(value.html || '').trim());

export function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
    return JSON.stringify(value);
}
export async function digest(value, algorithm = 'SHA-256') {
    const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(typeof value === 'string' ? value : stableJson(value));
    if (!globalThis.crypto?.subtle) return hashBytes(bytes, algorithm);
    return [...new Uint8Array(await crypto.subtle.digest(algorithm, bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
function identity(item, sourceId, kind, index) {
    return `${sourceId}:${kind}:${item.id ?? index}`;
}
function contentFor(kind, item) {
    const value = copy(item);
    for (const k of ['id', 'backupOrigins', 'historyOrder', 'chapterId', 'parentChapterId']) delete value[k];
    if (kind === 'dreams') {
        delete value.revision;
        if (value.source) delete value.source.refId;
        for (const chapter of list(value.chapters)) delete chapter.id;
    }
    if(kind==='recent'){
        const strip=result=>{for(const k of ['id','resultId','chapterId','parentChapterId','historyOrder'])delete result[k];for(const ancestor of list(result.seriesSources))strip(ancestor);};strip(value);
    }
    return value;
}
export async function itemFingerprint(kind, item) { return digest(contentFor(kind, item)); }

function cleanDream(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const input = copy(raw);
    input.chapters = list(input.chapters).filter(hasContent).map(ch => ({ ...ch, retainedVersions: list(ch.retainedVersions).filter(v => hasContent(v) && v.retained === true) }));
    if (input.draft) {
        const hadCandidates=list(input.draft.candidates).length>0;
        const selected = list(input.draft.candidates)[input.draft.selectedCandidateIndex || 0];
        input.draft.candidates = list(input.draft.candidates).filter(hasContent);
        input.draft.selectedCandidateIndex = Math.max(0,input.draft.candidates.indexOf(selected));
        if(hadCandidates&&!input.draft.candidates.length&&input.draft.status==='review'){
            input.draft.status='writing';input.draft.text='';input.draft.html='';
        }
        if (!good(input.draft)) input.draft = null;
    }
    const normalized = normalizeLongDreamRecord(input);
    if (!normalized) return null;
    const result = {};
    for (const key of ['id', 'schemaVersion', 'title', 'status', 'createdAt', 'updatedAt', 'canon', 'inheritance', 'source', 'sourceConfig', 'chapters', 'memory', 'draft', 'seriesMemoryAutoWeave']) {
        if (normalized[key] !== undefined) result[key] = normalized[key];
    }
    if (Number.isSafeInteger(normalized.revision) && normalized.revision >= 0) result.revision = normalized.revision;
    if (origins(raw).length) result.backupOrigins = origins(raw);
    if (raw.composerDraft && (String(raw.composerDraft.instruction || '').trim() || String(raw.composerDraft.title || '').trim() || Number.isFinite(Number(raw.composerDraft.targetChars)))) result.composerDraft = { instruction:String(raw.composerDraft.instruction || ''),title:String(raw.composerDraft.title || ''),targetChars:Number(raw.composerDraft.targetChars) || 3000 };
    return result;
}
function cleanResult(value,seen=new WeakSet(),depth=0) {
    if (!hasContent(value)) return null;
    if(seen.has(value)||depth>100)throw new Error('生成结果的系列快照结构异常，请先分项导出保留');
    seen.add(value);
    const result = {};
    for (const key of ['id', 'resultId', 'chapterId', 'parentChapterId', 'title', 'text', 'html', 'mode', 'date', 'time', 'createdAt', 'instruction', 'tags', 'roleSources', 'sourceConfig', 'continuationRounds', 'incomplete', 'finishReason', 'formatRecovered']) {
        if (value[key] !== undefined) result[key] = copy(value[key]);
    }
    const layout = value.layoutSource;
    if (Number.isFinite(layout?.targetChars) && typeof layout.text === 'string' && layout.text.trim()) {
        result.layoutSource = { targetChars: layout.targetChars, text: layout.text,
            originalInstruction: typeof layout.originalInstruction === 'string' ? layout.originalInstruction : '' };
    }
    if(Array.isArray(value.seriesSources))result.seriesSources=value.seriesSources.map(x=>cleanResult(x,seen,depth+1)).filter(Boolean);
    if (result.sourceConfig) result.sourceConfig = createHistoryJsonBackup([{...value,html:value.html || '<p>snapshot</p>'}]).items[0]?.sourceConfig || null;
    seen.delete(value);
    return result;
}
export function normalizeBackupData(data = {}) {
    const instructions = createInstructionBackup(data.instructionTags, data.instructions);
    const validInstructions=list(data.instructions).filter(item=>String(item?.content || '').trim());
    instructions.templates.forEach((item,index) => { if (origins(validInstructions[index]).length) item.backupOrigins = origins(validInstructions[index]); });
    const validHistory=orderedHistory(list(data.history).filter(hasContent)), historyById=new Map(validHistory.filter(x=>x.id!=null).map(x=>[String(x.id),x]));
    const history = createHistoryJsonBackup(validHistory, data.folders);
    history.items.forEach(item => {
        const raw = historyById.get(String(item.id));
        if (origins(raw).length) item.backupOrigins = origins(raw);
        if(Number.isFinite(Number(raw?.historyOrder))) item.historyOrder=Number(raw.historyOrder);
    });
    const foldersById=new Map(list(data.folders).map(x=>[String(x.id),x]));
    return {
        instructions: instructions.templates, instructionTags: instructions.tags,
        history: history.items, folders: history.folders.map(folder => {
            const raw = foldersById.get(folder.id);
            return origins(raw).length ? { ...folder, backupOrigins: origins(raw) } : folder;
        }),
        dreams: list(data.dreams).map(cleanDream).filter(Boolean),
        current: cleanResult(data.current), recent: list(data.recent).map(value=>cleanResult(value)).filter(Boolean),
        recovered: list(data.recovered).map(value=>cleanResult(value)).filter(Boolean),
    };
}
export function backupCounts(data) {
    return {
        instructions: data.instructions.length, history: data.history.length, dreams: data.dreams.length,
        chapters: data.dreams.reduce((n, d) => n + d.chapters.length, 0),
        candidates: data.dreams.reduce((n, d) => n + list(d.draft?.candidates).length, 0),
        retained: data.dreams.reduce((n, d) => n + d.chapters.reduce((m, ch) => m + list(ch.retainedVersions).length, 0), 0),
        drafts: data.dreams.filter(d => d.draft || d.composerDraft).length,
    };
}
export async function createCompleteBackup(data, { sourceId, deviceName, now = new Date() }) {
    const normalized = normalizeBackupData(data);
    const checksum = await digest(normalized);
    return { format: BACKUP_FORMAT, version: BACKUP_VERSION, sourceId, deviceName: String(deviceName || '本机').slice(0, 40), exportedAt: now.toISOString(), checksum, counts: backupCounts(normalized), data: normalized };
}
export async function parseCompleteBackup(value) {
    if (value?.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION || !value.data || !/^[a-f0-9-]{16,80}$/i.test(String(value.sourceId))) throw new Error('备份格式或版本不受支持');
    if (await digest(value.data) !== value.checksum) throw new Error('备份校验失败，文件可能不完整');
    const data = normalizeBackupData(value.data);
    return { ...value, data, counts: backupCounts(data) };
}
export function backupProtection(previous, current) {
    return ['instructions','history','dreams','chapters','retained','candidates','drafts'].filter(k => {
        if(['candidates','drafts'].includes(k)&&current.chapters>Number(previous?.chapters || 0))return false;
        return Number(previous?.[k])>0&&(current[k]===0||(previous[k]>=10&&current[k]<previous[k]*0.5));
    });
}

// Prepare an append-only plan. Original records are never rewritten to match a backup.
export async function planBackupRestore(current, packet, selected, localSourceId) {
    if (packet.packets) {
        let next = current;
        const stats = {}, additions = { history: [], dreams: [] }; let changed = 0;
        for (const part of packet.packets) {
            const plan = await planBackupRestore(next, part, selected, localSourceId);
            next = plan.next; changed += plan.changed;
            for (const kind of Object.keys(plan.stats)) {
                if (!stats[kind]) stats[kind] = { added: 0, same: 0, different: 0 };
                for (const count of ['added', 'same', 'different']) stats[kind][count] += plan.stats[kind][count];
            }
            additions.history.push(...plan.additions.history); additions.dreams.push(...plan.additions.dreams);
        }
        return { next, stats, additions, changed, counts: packet.counts };
    }
    const incoming = packet.data;
    const next = copy(current);
    const stats = {}, additions = { history: [], dreams: [] };
    const maps = { history: new Map(), chapters: new Map() };
    // A scoped dream restore may link to already-existing history without restoring it.
    if ((selected.includes('dreams')||selected.includes('recent'))&&!selected.includes('history')) {
        const hashes=new Map(),identities=new Map();
        for(let i=0;i<current.history.length;i++){
            const item=current.history[i];hashes.set(await itemFingerprint('history',item),item);
            identities.set(identity(item,localSourceId,'history',i),item);for(const origin of origins(item))identities.set(origin,item);
        }
        for(let i=0;i<incoming.history.length;i++){
            const item=incoming.history[i],matched=hashes.get(await itemFingerprint('history',item))||identities.get(identity(item,packet.sourceId,'history',i))||origins(item).map(o=>identities.get(o)).find(Boolean);
            if(matched){maps.history.set(String(item.id),String(matched.id));maps.chapters.set(String(item.chapterId||`saved:${item.id}`),historyKey(matched));}
        }
    }
    for (const kind of ['instructions', 'history', 'dreams']) {
        const count = stats[kind] = { added: 0, same: 0, different: 0 };
        if (!selected.includes(kind)) continue;
        const fingerprints = new Map(), identities = new Map();
        let order=kind==='history'?next.history.reduce((n,item)=>Math.max(n,Number(item.historyOrder)||Number(item.id)||0),0):0;
        for (let i = 0; i < next[kind].length; i++) {
            const item = next[kind][i];
            fingerprints.set(await itemFingerprint(kind, item), item);
            identities.set(identity(item, localSourceId, kind, i), item);
            for (const origin of origins(item)) identities.set(origin, item);
        }
        for (let i = 0; i < incoming[kind].length; i++) {
            const item = incoming[kind][i], hash = await itemFingerprint(kind, item);
            const key = identity(item, packet.sourceId, kind, i);
            const related = identities.get(key) || origins(item).map(o => identities.get(o)).find(Boolean);
            let restored = fingerprints.get(hash);
            if (restored) count.same++;
            else {
                restored = copy(item);
                restored.backupOrigins = [...new Set([...origins(item), key])];
                if (kind !== 'instructions') restored.id = newHistoryKey();
                if (kind === 'history') {
                    const originalChapter = String(item.chapterId || `saved:${item.id}`);
                    restored.chapterId = related ? historyKey(related) : maps.chapters.get(originalChapter) || newHistoryKey();
                    restored.historyOrder = ++order;
                }
                next[kind].push(restored);
                if (additions[kind]) additions[kind].push(restored);
                fingerprints.set(hash, restored); identities.set(key, restored);
                count[related ? 'different' : 'added']++;
            }
            if (kind === 'history') {
                if (item.id != null) maps.history.set(String(item.id), String(restored.id));
                maps.chapters.set(String(item.chapterId || `saved:${item.id}`), historyKey(restored));
            }
        }
    }
    if (selected.includes('history')) {
        for (const item of additions.history) {
            item.parentChapterId = maps.chapters.get(String(item.parentChapterId)) || '';
        }
        const owned = new Set(next.folders.flatMap(f => f.itemIds));
        for (let index = 0; index < incoming.folders.length; index++) {
            const folder = incoming.folders[index], key = identity(folder, packet.sourceId, 'folders', index);
            const ids = [...new Set(folder.itemIds.map(id => maps.history.get(String(id))).filter(Boolean))];
            const aliases=new Set([key,...origins(folder)]);
            let target = next.folders.find((f,i) => aliases.has(identity(f,localSourceId,'folders',i)) || origins(f).some(o=>aliases.has(o)) || (f.title === folder.title && stableJson(f.itemIds) === stableJson(ids)));
            const available = ids.filter(id => !owned.has(id));
            if (!target && (available.length || !ids.length)) {
                target = { id: newHistoryKey(), title: folder.title, itemIds: [], backupOrigins: [...new Set([...origins(folder), key])] };
                next.folders.push(target);
            }
            if (target) { target.itemIds.push(...available); available.forEach(id => owned.add(id)); }
        }
    }
    // Source references are local links, never unverified IDs from another browser.
    for (const dream of additions.dreams) {
        if (dream.source?.kind === 'history') dream.source.refId = maps.history.get(String(dream.source.refId)) || null;
        else if (dream.source?.kind === 'history-folder') {
            const sourceFolder = incoming.folders.find(f => String(f.id) === String(dream.source.refId));
            const aliases=new Set(sourceFolder?[identity(sourceFolder,packet.sourceId,'folders',incoming.folders.indexOf(sourceFolder)),...origins(sourceFolder)]:[]);
            const ids=sourceFolder?.itemIds.map(id=>maps.history.get(String(id))).filter(Boolean)||[];
            dream.source.refId = next.folders.find((f,i) => origins(f).some(o=>aliases.has(o))||aliases.has(identity(f,localSourceId,'folders',i))||(ids.length&&f.title===sourceFolder?.title&&stableJson(f.itemIds)===stableJson(ids)))?.id || null;
        }
    }
    stats.recent = { added: 0, same: 0, different: 0 };
    if (selected.includes('recent')) {
        const existing = [next.current, ...next.recent, ...next.recovered].filter(Boolean);
        const fingerprints = new Set(await Promise.all(existing.map(x => itemFingerprint('recent', x))));
        const resultKeys=new Map(maps.chapters);
        const keyFor=key=>{if(!key)return '';if(!resultKeys.has(key))resultKeys.set(key,newHistoryKey());return resultKeys.get(key);};
        function remapResult(value){
            const saved=copy(value),key=String(value.chapterId||value.resultId||(value.id!=null?`saved:${value.id}`:''));
            if(key)saved.chapterId=keyFor(key);
            if(value.resultId)saved.resultId=keyFor(String(value.resultId));
            if(value.parentChapterId)saved.parentChapterId=keyFor(String(value.parentChapterId));
            if(value.id!=null)saved.id=maps.history.get(String(value.id))||`backup-unlinked:${newHistoryKey()}`;
            if(Array.isArray(value.seriesSources))saved.seriesSources=value.seriesSources.map(remapResult);
            return saved;
        }
        for (const result of [incoming.current, ...incoming.recent, ...incoming.recovered].filter(Boolean)) {
            const hash = await itemFingerprint('recent', result);
            if (fingerprints.has(hash)) stats.recent.same++;
            else {
                const saved = remapResult(result);
                saved.id = newHistoryKey();
                next.recovered.push(saved); fingerprints.add(hash); stats.recent.added++;
            }
        }
    }
    if (selected.includes('instructions')) next.instructionTags = [...new Set([...next.instructionTags, ...incoming.instructionTags])];
    if (selected.includes('history')) next.instructionTags = [...new Set([...next.instructionTags,...incoming.history.flatMap(x=>x.tags || [])])];
    const changed = Object.values(stats).reduce((n, s) => n + s.added + s.different, 0) + (stableJson(next.instructionTags)!==stableJson(current.instructionTags)?1:0) + (stableJson(next.folders) !== stableJson(current.folders) ? 1 : 0);
    return { next, stats, additions, changed, counts: packet.counts };
}
