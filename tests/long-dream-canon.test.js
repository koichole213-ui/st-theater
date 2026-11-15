// 从 core.test.js 拆出：long-dream-canon
import test from 'node:test';
import assert from 'node:assert/strict';
import { LONG_DREAM_CANON_SUGGESTION_CATEGORIES, buildLongDreamCanonSuggestionPayload, composeLongDreamCanon, parseLongDreamCanonSuggestions } from '../long-dream-canon-suggestions.js';

test('AI 定梦建议只读取第一章正文，并明确输出待确认草稿', () => {
    const payload = buildLongDreamCanonSuggestionPayload({
        sourceTitle: '雨夜旧站',
        sourceText: '林岚在末班车离开后独自留在旧站。',
    });
    assert.match(payload.userPrompt, /雨夜旧站/);
    assert.match(payload.userPrompt, /林岚在末班车离开后独自留在旧站/);
    assert.match(payload.systemPrompt, /只依据提供的第一章正文/);
    assert.match(payload.systemPrompt, /uncertain/);
    assert.doesNotMatch(payload.userPrompt, /世界书|聊天前文/);
    assert.equal(payload.sourceChars, 16);
});

test('AI 定梦建议解析会保留不确定标记、归一分类并去重', () => {
    const items = parseLongDreamCanonSuggestions(`<thinking>这里不能显示</thinking>\n\n\`\`\`json
{
  "items": [
    { "category": "关系", "content": "林岚与周遥是旧识。", "uncertain": true, "uncertaintyNote": "正文没有说明相识年份。" },
    { "category": "人物关系", "content": "林岚与周遥是旧识。" },
    { "category": "事件", "content": "末班车已经离站。", "confidence": "high" }
  ]
}
\`\`\``);
    assert.equal(items.length, 2);
    assert.equal(items[0].category, '人物关系');
    assert.equal(items[0].uncertain, true);
    assert.equal(items[0].uncertaintyNote, '正文没有说明相识年份。');
    assert.equal(items[0].accepted, false);
    assert.equal(items[1].category, '已发生事件');
    assert.deepEqual(LONG_DREAM_CANON_SUGGESTION_CATEGORIES, ['人物关系', '时间地点', '已发生事件', '不可违反事实']);
});

test('只有用户逐项采纳的 AI 建议会与手写定梦合并，未确认项不进入 canon', () => {
    const manual = '手写定梦：列车不能驶离环线。';
    const canon = composeLongDreamCanon(manual, [
        { category: '人物关系', content: '林岚与周遥是旧识。', accepted: true },
        { category: '时间地点', content: '故事发生在冬季。', accepted: false },
        { category: '不可违反事实', content: '列车不能驶离环线。', accepted: true },
    ]);
    assert.match(canon, /^手写定梦：列车不能驶离环线。/);
    assert.match(canon, /【逐项确认的 AI 定梦建议】/);
    assert.match(canon, /【人物关系】林岚与周遥是旧识。/);
    assert.doesNotMatch(canon, /故事发生在冬季/);
    assert.equal(canon.match(/列车不能驶离环线/g)?.length, 1);
    assert.equal(composeLongDreamCanon(manual, []), manual);
});
