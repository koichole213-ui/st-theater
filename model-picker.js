// Render model choices inside the owning popup, never in a body-level dropdown.
export function closeModelPicker(doc=globalThis.document) { doc?.getElementById?.('theater-model-picker')?.remove(); }
export function showModelPicker(models,{selected='',onSelect,isCurrent=()=>true,document:doc=globalThis.document}={}) {
    const input=doc?.getElementById?.('theater-api-model');
    if(!input) return;
    closeModelPicker(doc);
    const host=input.closest('.theater-config-model-control');if(!host)return;
    const box=doc.createElement('section');box.id='theater-model-picker';box.className='theater-model-picker';box.setAttribute('aria-label','选择当前渠道的模型');
    const heading=doc.createElement('div');heading.className='theater-model-picker-heading';
    const title=doc.createElement('b');title.textContent='选择模型';
    const close=doc.createElement('button');close.type='button';close.className='theater-model-picker-close';close.textContent='收起';
    close.onclick=()=>{box.remove();input.focus()};heading.append(title,close);
    const search=doc.createElement('input');search.type='search';search.className='theater-input';search.placeholder='搜索模型名称…';search.setAttribute('aria-label','搜索模型名称');
    const count=doc.createElement('p');count.className='theater-model-picker-count';count.setAttribute('role','status');
    const list=doc.createElement('div');list.className='theater-model-picker-list';list.setAttribute('role','group');list.setAttribute('aria-label','模型结果');
    const safeModels=[...new Set(models.filter(model=>typeof model==='string'&&model.trim()).map(model=>model.trim()))];
    const render=()=>{const query=search.value.trim().toLowerCase();const shown=safeModels.filter(model=>model.toLowerCase().includes(query));list.replaceChildren();count.textContent=`显示 ${shown.length} / ${safeModels.length} 个模型`;
        const fragment=doc.createDocumentFragment();
        for(const model of shown){const button=doc.createElement('button');button.type='button';button.className='theater-model-picker-option';button.textContent=model;button.setAttribute('aria-pressed',String(model===selected));
            button.onclick=()=>{if(!isCurrent()){box.remove();return}onSelect?.(model);box.remove();input.focus()};fragment.append(button)}
        list.append(fragment);if(!shown.length){const empty=doc.createElement('p');empty.className='theater-model-picker-empty';empty.textContent='没有匹配的模型，可以直接在上方手动填写。';list.append(empty)}
    };
    search.addEventListener('input',render);box.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.click()}});
    box.append(heading,search,count,list);host.append(box);render();search.focus();return box;
}
