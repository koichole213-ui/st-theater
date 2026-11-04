// Fixed, public-safe guidance. Never store server messages or request contents here.
export const ERROR_HELP=Object.freeze({
  "T-HTTP-503": {
    "title": "服务暂时不可用",
    "detail": "接口返回了 503，未说明具体故障环节。",
    "action": "稍后再试；持续出现时检查线路状态。",
    "steps": [
      "先稍等一会儿，再手动尝试。",
      "如果同一线路持续报错，查看服务商状态或换到已确认可用的线路。",
      "仍然失败时，提供错误时间、503 状态码和脱敏诊断报告。"
    ],
    "group": "服务与网关",
    "status": "bad"
  },
  "T-API-MESSAGE-END": {
    "title": "模型不接受当前消息结尾",
    "detail": "当前模型不支持请求以助手消息结尾（助手预填）。",
    "action": "保留预设内容；需要助手预填时，请选择支持它的模型或线路。",
    "steps": [
      "保留当前预设、世界书和指令，不需要先删除内容。",
      "记录所选渠道、模型和错误时间，复制脱敏诊断报告。",
      "插件不会自动改写、删除助手尾或补用户消息；需要保留助手预填时，手动选择支持它的模型或线路。"
    ],
    "group": "消息与参数",
    "status": "bad"
  },
  "T-HTTP-400": {
    "title": "接口拒绝请求，原因尚不明确",
    "detail": "接口返回 400，但没有可识别的具体拒绝原因。",
    "action": "先保留现有配置，查看诊断记录。",
    "steps": [
      "先保留当前预设和世界书，不按一个笼统的 400 反复修改。",
      "核对所选渠道、模型、接入类型和地区是否与可用配置一致。",
      "复制脱敏诊断报告，继续核对具体拒绝原因。"
    ],
    "group": "消息与参数",
    "status": "bad"
  },
  "T-HTTP-401": {
    "title": "接口认证未通过",
    "detail": "接口返回 401，当前认证未被接受。",
    "action": "检查这条线路的密钥或凭证绑定。",
    "steps": [
      "确认选中的是这条线路对应的 API 预设。",
      "在设置中核对密钥或凭证状态，不要将密钥贴到聊天或截图里。",
      "如果刚换过凭证，重新绑定并保存对应预设，再手动测试。"
    ],
    "group": "认证与权限",
    "status": "bad"
  },
  "T-API-CREDENTIAL-AUTH": {
    "title": "服务账号认证失败",
    "detail": "酒馆后端明确报告：服务账号认证未完成。",
    "action": "先检查凭证认证，不需要改创作预设。",
    "steps": [
      "确认酒馆当前使用的也是同一种服务账号 JSON 认证。",
      "检查该凭证是否仍有效、对应项目是否正确。",
      "若酒馆同样认证失败，先处理酒馆凭证状态；不要反复生成正文。"
    ],
    "group": "认证与权限",
    "status": "bad"
  },
  "T-API-CREDENTIAL-CHANGED": {
    "title": "绑定的凭证已发生变化",
    "detail": "当前酒馆凭证与此预设保存的引用不同。",
    "action": "重新绑定当前凭证，再保存预设。",
    "steps": [
      "打开这一份 Vertex API 预设。",
      "点击“使用酒馆已有凭证”，确认后保存。",
      "再次使用前核对预设，不需要把 JSON 内容发给任何人。"
    ],
    "group": "认证与权限",
    "status": "bad"
  },
  "T-HTTP-403": {
    "title": "当前访问未获允许",
    "detail": "接口返回 403，具体权限原因未说明。",
    "action": "核对账号、项目和模型的访问权限。",
    "steps": [
      "核对该账号或项目是否允许调用所选模型。",
      "若接口另有明确的地区、账单或权限提示，按那条提示处理。",
      "不要只凭 403 删除世界书或更换预设。"
    ],
    "group": "认证与权限",
    "status": "bad"
  },
  "T-API-MODEL-UNAVAILABLE": {
    "title": "所选模型或地区不可用",
    "detail": "接口明确说明当前模型在这一路线或地区不可用。",
    "action": "核对模型完整名称及地区。",
    "steps": [
      "核对模型名称，避免使用另一平台的模型别名。",
      "Vertex 等分地区渠道需核对该模型可用地区。",
      "保存正确配置后，先手动测试连接。"
    ],
    "group": "模型与地址",
    "status": "bad"
  },
  "T-HTTP-404": {
    "title": "接口资源不存在",
    "detail": "接口返回 404，未说明是地址路径还是模型资源不存在。",
    "action": "核对接口地址和模型名。",
    "steps": [
      "确认接口地址属于当前所选渠道和接入类型。",
      "核对模型名以及是否需要完整模型路径或接入点 ID。",
      "如果地址来自服务商控制台，以当前控制台提供的地址为准。"
    ],
    "group": "模型与地址",
    "status": "bad"
  },
  "T-API-PARAMETER-UNSUPPORTED": {
    "title": "模型不支持某项请求参数",
    "detail": "接口明确说明有不支持的请求字段。",
    "action": "保留创作内容，检查这条线路的参数适配。",
    "steps": [
      "保留预设正文和世界书，不靠删内容处理参数问题。",
      "记录所选渠道、模型和错误类别。",
      "复制脱敏诊断报告，以便核对是哪项发送参数不兼容。"
    ],
    "group": "消息与参数",
    "status": "bad"
  },
  "T-HTTP-422": {
    "title": "接口未通过请求校验",
    "detail": "接口返回 422，但未提供可识别的字段原因。",
    "action": "核对配置，并保留诊断信息。",
    "steps": [
      "核对模型、接口地址和配置值。",
      "如果诊断识别到了具体参数类别，优先按该类别处理。",
      "不要仅凭 422 调整故事内容；复制报告继续核对请求。"
    ],
    "group": "消息与参数",
    "status": "bad"
  },
  "T-HTTP-429": {
    "title": "请求受到限流或额度限制",
    "detail": "接口返回 429，尚未说明是请求频率还是可用额度。",
    "action": "先稍等，持续出现再查额度和并发。",
    "steps": [
      "等当前任务结束，避免连续重复点击生成。",
      "稍后手动尝试；若提示中有等待时间，按提示等待。",
      "持续出现时，查看服务商的配额、额度或并发限制。"
    ],
    "group": "限流与额度",
    "status": "warn"
  },
  "T-API-CREDIT-EXHAUSTED": {
    "title": "接口报告可用额度不足",
    "detail": "接口明确提示余额或可用额度不足。",
    "action": "查看服务商账户的额度状态。",
    "steps": [
      "打开当前线路服务商的账户或用量页面。",
      "确认选中的密钥、项目和计费账户正确。",
      "额度恢复前先停止重复请求，或手动选择其他可用线路。"
    ],
    "group": "限流与额度",
    "status": "bad"
  },
  "T-API-CONTEXT-LIMIT": {
    "title": "接口报告上下文容量不足",
    "detail": "接口明确表示输入与预留输出超出可接受容量。",
    "action": "按实际需求减少携带资料，或调整输出上限。",
    "steps": [
      "先核对本次实际携带的聊天、预设和世界书。",
      "手动减少非必要资料，或选择容量更大的线路。",
      "必要时手动降低输出上限；页面 Token 粗估不等于服务端实际统计。"
    ],
    "group": "输入与输出",
    "status": "bad"
  },
  "T-API-OUTPUT-LIMIT": {
    "title": "接口拒绝输出上限",
    "detail": "接口明确表示当前单次输出 Token 设置不被接受。",
    "action": "核对模型允许的单次输出上限。",
    "steps": [
      "查看本次输出上限与诊断中的已有调整记录。",
      "核对服务商对该模型的单次输出限制。",
      "需要时在 API 设置中手动调整，不必先删除创作资料。"
    ],
    "group": "输入与输出",
    "status": "bad"
  },
  "T-HTTP-502": {
    "title": "网关返回异常响应",
    "detail": "接口返回 502，具体出错的服务节点未说明。",
    "action": "稍后尝试；持续出现再核对线路。",
    "steps": [
      "稍等后再手动尝试。",
      "同一线路持续出现时，查看服务商状态或换到可用线路。",
      "提供错误时间和脱敏诊断，不能仅凭 502 认定是本机代理。"
    ],
    "group": "服务与网关",
    "status": "bad"
  },
  "T-HTTP-504": {
    "title": "网关等待上游超时",
    "detail": "接口返回 504，网关未在其等待时间内取得上游结果。",
    "action": "先等当前请求结束，再手动尝试。",
    "steps": [
      "不要连续点击生成，以免同时发出多个请求。",
      "查看连接过程，确认是否已收到部分正文。",
      "持续出现时，核对线路状态；插件本地增加等待不一定能改变网关时限。"
    ],
    "group": "服务与网关",
    "status": "bad"
  },
  "T-HTTP-520": {
    "title": "服务端返回异常状态",
    "detail": "接口返回 520，响应未提供可识别的具体原因。",
    "action": "保留状态码和时间，核对线路状态。",
    "steps": [
      "稍后尝试，不需要先改预设或重填密钥。",
      "查看服务商状态与当前线路是否正常。",
      "持续出现时，提供实际状态码和错误时间继续排查。"
    ],
    "group": "服务与网关",
    "status": "bad"
  },
  "T-NET-NO-RESPONSE": {
    "title": "未取得可读取的响应",
    "detail": "请求尚未取得可读取的响应头，连接就结束了。",
    "action": "先对比这条线路的连接方式。",
    "steps": [
      "确认当前网络与服务商线路可访问。",
      "同模型的酒馆主 API 能用时，优先对比独立线路的连接方式。",
      "查看失败阶段和耗时，不能仅凭此信号认定跨域或代理故障。"
    ],
    "group": "连接与等待",
    "status": "bad"
  },
  "T-NET-STREAM-INTERRUPTED": {
    "title": "返回过程中连接中断",
    "detail": "已经收到响应，读取后续数据时连接中断。",
    "action": "先查看已保留内容，再决定是否重试。",
    "steps": [
      "先查看当前保留的正文，避免重复生成同一段。",
      "可在设置中手动关闭流式，作为下一次请求的对照。",
      "保留错误时间、已收数据量和失败阶段，继续核对线路。"
    ],
    "group": "连接与等待",
    "status": "bad"
  },
  "T-NET-TIMEOUT": {
    "title": "等待响应超时",
    "detail": "本次请求超过了当前等待时限。",
    "action": "核对失败阶段与已保留内容。",
    "steps": [
      "先查看是否已经收到并保留部分正文。",
      "等旧请求结束后再尝试，避免重复任务。",
      "结合首字等待、流式静默或完整响应阶段继续排查。"
    ],
    "group": "连接与等待",
    "status": "bad"
  },
  "T-API-EMPTY": {
    "title": "响应中没有可读正文",
    "detail": "接口已返回，但没有取得可显示的正文。",
    "action": "核对响应结构与结束原因。",
    "steps": [
      "查看是否有明确内容拦截、思考内容或截断信号。",
      "若信息不足，保留未知，不直接认定模型拒绝写作。",
      "复制诊断报告，核对该线路的响应格式。"
    ],
    "group": "输入与输出",
    "status": "bad"
  },
  "T-API-REASONING-ONLY": {
    "title": "响应只有思考，没有正文",
    "detail": "已识别到思考内容，但未找到可显示正文。",
    "action": "核对输出要求与结束信息。",
    "steps": [
      "查看是否同时报告了输出达到上限。",
      "核对预设是否要求在思考之后输出正文。",
      "保留诊断信息，不将这次空正文自动认定为内容拦截。"
    ],
    "group": "输入与输出",
    "status": "bad"
  },
  "T-API-INVALID-RESPONSE": {
    "title": "返回内容不是可识别的接口响应",
    "detail": "返回了不符合当前协议的内容，例如 HTML 页面或损坏的数据。",
    "action": "核对接口路径、协议与线路响应格式。",
    "steps": [
      "确认地址指向 API 接口，而不是网站首页。",
      "核对当前线路的协议选择。",
      "保留响应类型和状态码，不把原始页面内容当正文保存。"
    ],
    "group": "输入与输出",
    "status": "bad"
  },
  "T-API-CONTENT-FILTER": {
    "title": "接口明确报告内容拦截",
    "detail": "服务端提供了明确的内容策略拦截信号。",
    "action": "查看本次参与的资料，核对线路规则。",
    "steps": [
      "查看最近请求摘要，确认参与了哪些上下文与补充。",
      "按服务商规则检查相关资料；不要只把问题归给当前指令。",
      "若认为是误判，保留脱敏诊断向服务商反馈。"
    ],
    "group": "输入与输出",
    "status": "bad"
  },
  "T-RENDER-INVALID": {
    "title": "正文已完成，HTML 排版未通过",
    "detail": "排版结果未通过完整性检查。",
    "action": "正文已经保留，可以稍后单独重试排版。",
    "steps": [
      "先查看保留的纯文字正文。",
      "需要时使用现有“重试排版”入口，或选择其他模板。",
      "无需为一次排版失败重新生成整篇故事。"
    ],
    "group": "排版与保存",
    "status": "bad"
  },
  "T-STORAGE-WRITE": {
    "title": "本地保存未完成",
    "detail": "这次本地写入没有完成。",
    "action": "先导出当前内容，避免刷新丢失未保存稿。",
    "steps": [
      "先复制或导出当前还能看到的正文。",
      "暂时不要清浏览器数据、重装插件或覆盖旧存档。",
      "保留脱敏报告，核对存储空间和数据库状态。"
    ],
    "group": "排版与保存",
    "status": "bad"
  },
  "T-UNKNOWN": {
    "title": "暂时无法归类的问题",
    "detail": "目前取得的信息不足以给出可靠分类。",
    "action": "保留现场，复制诊断继续排查。",
    "steps": [
      "保留当前页面中可见的正文。",
      "复制脱敏诊断报告，记下刚才进行的操作。",
      "不要反复清数据或更换多项配置，以免丢失可比较的现场。"
    ],
    "group": "其他情况",
    "status": "bad"
  },
  "T-API-INPUT-LIMIT": {
    "title": "接口报告输入内容过大",
    "detail": "接口明确表示本次输入超出允许的大小。",
    "action": "核对实际携带资料，再手动减少非必要输入。",
    "steps": [
      "查看本次携带的预设、世界书和聊天范围。",
      "按实际需要减少非必要内容；不要直接清空全部设定。",
      "也可以手动选择服务商确认支持更大输入的模型。"
    ],
    "group": "输入与输出",
    "status": "bad"
  },
  "T-API-TRUNCATED": {
    "title": "输出达到上限，正文已保留",
    "detail": "接口报告输出触及上限，本轮内容可能尚未完整。",
    "action": "先看已保留的正文，再决定后续操作。",
    "steps": [
      "查看当前保留的正文及结束位置。",
      "结合原有补写开关和轮次记录，确认是否已按现有流程继续。",
      "需要调整时，核对模型的输出上限；不必重新生成已经写好的部分。"
    ],
    "group": "输入与输出",
    "status": "warn"
  },
  "T-API-CONFIG": {
    "title": "连接配置还未填完整",
    "detail": "发送前检查发现必要配置缺失或格式无效。",
    "action": "回到所选 API 预设，补齐提示的配置。",
    "steps": [
      "打开当前选用的 API 预设。",
      "核对地址、模型和该渠道所需的认证信息。",
      "保存后手动测试连接；没有必要先重写创作指令。"
    ],
    "group": "模型与地址",
    "status": "bad"
  }
});

// Read only explicit error fields. Nested JSON messages are common in gateways.
export function httpErrorReason(body='') {
 let value=String(body).slice(0,32768),text='';
 for(let depth=0;depth<3;depth++){
  let parsed;try{parsed=JSON.parse(value)}catch{if(depth===0&&!/[<>]/.test(value))text=value;else if(depth>0)text=value;break}
  const e=parsed?.error;
  const codes=[e?.code,e?.type,e?.status,parsed?.code,parsed?.type,parsed?.status];
  if(codes.some(code=>typeof code==='string'&&/^(?:content_policy_violation|content_filter|safety|prohibited_content|blocked_by_safety)$/i.test(code)))return 'T-API-CONTENT-FILTER';
  const message=typeof e==='string'?e:typeof e?.message==='string'?e.message:typeof parsed?.message==='string'?parsed.message:'';
  if(!message)break;value=message;text=message;
 }
 if(/service account authentication failed|invalid_grant|invalid jwt|invalid jwt signature|unauthorized_client/i.test(text))return 'T-API-CREDENTIAL-AUTH';
 if(/requests? ending with (?:a )?model turn.{0,60}(?:not supported|unsupported|not allowed)|(?:does not|doesn\x27t) support (?:assistant|model)(?: message)? prefill|(?:assistant|model)(?: message)? prefill(?:ing)? (?:is )?(?:not supported|unsupported)|(?:last|final) (?:message|turn)(?: in (?:the )?(?:request|conversation))? (?:must|should) (?:be|have (?:the )?role) [\x27\"]?user|(?:must not|cannot|can\x27t) end (?:with|on) (?:an? )?[\x27\"]?(?:assistant|model)|prefill(?:ed)? (?:model|assistant) (?:turns?|messages?).*(?:not supported|unsupported)/i.test(text))return 'T-API-MESSAGE-END';
 if(/(?:insufficient|exhausted|out of|no remaining).{0,24}(?:credits?|balance)|(?:credits?|balance).{0,24}(?:insufficient|exhausted)|余额不足|余额已耗尽/i.test(text))return 'T-API-CREDIT-EXHAUSTED';
 if(/(?:model|publisher model).{0,100}(?:not found|does not exist|not available|not supported in|not accessible)|(?:location|region).{0,80}(?:not supported|not available|invalid)|模型.{0,30}(?:不存在|不可用)|地区.{0,20}(?:不支持|不可用)/i.test(text))return 'T-API-MODEL-UNAVAILABLE';
 if(/unknown (?:name|field|parameter)|unrecognized (?:field|parameter)|unsupported (?:parameter|field)|(?:parameter|field).{0,80}(?:not supported|not allowed)|不支持.{0,10}参数/i.test(text))return 'T-API-PARAMETER-UNSUPPORTED';
 return null;
}
