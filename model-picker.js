// Keep the original dropdown + manual-input layout inside the owning popup.
export function closeModelPicker(doc = globalThis.document) {
    doc?.getElementById?.('theater-model-picker')?.remove();
    const select = doc?.getElementById?.('theater-api-model-select');
    if (!select) return;
    select.onchange = null;
    select.replaceChildren();
    select.hidden = true;
    select.style.display = 'none';
}

export function showModelPicker(models, {
    selected = '', onSelect, isCurrent = () => true, document: doc = globalThis.document,
} = {}) {
    const input = doc?.getElementById?.('theater-api-model');
    const select = doc?.getElementById?.('theater-api-model-select');
    if (!input || !select || !isCurrent()) return;
    closeModelPicker(doc);
    const safeModels = [...new Set(models.filter(model => typeof model === 'string' && model.trim()).map(model => model.trim()))];
    const placeholder = doc.createElement('option');
    placeholder.value = ''; placeholder.textContent = '-- 选择模型 --';
    select.append(placeholder);
    for (const model of safeModels) {
        const option = doc.createElement('option');
        option.value = model; option.textContent = model;
        select.append(option);
    }
    select.value = safeModels.includes(selected) ? selected : '';
    select.hidden = false;
    select.style.removeProperty('display');
    select.onchange = () => {
        if (!isCurrent()) { closeModelPicker(doc); return; }
        if (select.value && safeModels.includes(select.value)) onSelect?.(select.value);
    };
    return select;
}
