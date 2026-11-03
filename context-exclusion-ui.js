import {validateContextExclusionRule} from './context-exclusions.js';
export function syncContextExclusionDraft() {
    const type=$('#theater-exclusion-type').val()||'tag',tag=type==='tag';
    $('[data-exclusion-type]').each(function(){const selected=this.dataset.exclusionType===type;$(this).attr('aria-pressed',String(selected)).toggleClass('active',selected)});
    $('#theater-exclusion-value-label').text(tag?'标签名':'要排除的完整原文');
    $('#theater-exclusion-value').attr('rows',tag?'1':'3').toggleClass('is-tag',tag)
        .attr('placeholder',tag?'例如 status':'粘贴每次完全相同的尾注或文字…');
    $('#theater-exclusion-help').text(tag?'例如原文是 <status>人物状态</status>，这里只填 status。不是作品或指令的分类标签。':'空格和换行也要相同；内容每次变化时，更适合使用“按标签整块排除”。');
    const {rule}=validateContextExclusionRule({type,value:$('#theater-exclusion-value').val()});
    $('#theater-exclusion-effect-label').text(tag?'添加后，将忽略下面这一整块':'添加后，只忽略完全相同的这段原文');
    $('#theater-exclusion-effect').text(rule?(tag?`<${rule.value}>这里的全部内容</${rule.value}>`:rule.value):(tag?'<标签名>这里的全部内容</标签名>':'填写原文后，在这里确认匹配内容'));
    $('#theater-exclusion-tag-caution').prop('hidden',!tag);
}
