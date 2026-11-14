// Provider wording is kept separately, after redaction, in providerMessage.
export const ERROR_HELP = Object.freeze({
    "T-API-PROVIDER-ERROR": {
        "title": "中转服务在生成途中报错",
        "side": "far",
        "what": "请求已经送到中转，但中转（或它背后的模型）在生成过程中报了错。常见原因是模型过载、排队超时，或中转自动重试的次数用完了。",
        "steps": [
            "等一两分钟再生成，通常就会恢复。",
            "经常出现的话，点“复制问题信息”，发给中转的维护者。"
        ],
        "group": "服务与网关",
        "status": "bad"
    },
    "T-HTTP-5XX": {
        "title": "服务器内部出错",
        "side": "far",
        "what": "服务商或中转的服务器在处理请求时出了错，问题不在你的设置或内容。",
        "steps": [
            "稍后再试。",
            "持续出现时，换一条确认可用的线路，或联系线路提供者。"
        ],
        "group": "服务与网关",
        "status": "bad"
    },
    "T-HTTP-502": {
        "title": "中转网关出错",
        "side": "far",
        "what": "中转没能从上游模型那里拿到正常的回复，通常是中转和上游之间的连接临时出了问题。",
        "steps": [
            "稍后再试。",
            "持续出现时，联系线路提供者，并附上出错时间。"
        ],
        "group": "服务与网关",
        "status": "bad"
    },
    "T-HTTP-503": {
        "title": "服务暂时不可用",
        "side": "far",
        "what": "对方服务器回复“暂时不可用”，通常是使用的人太多，或者正在维护。",
        "steps": [
            "等几分钟再试。",
            "一直不恢复的话，先换一条能用的线路，或问问线路提供者是否在维护。"
        ],
        "group": "服务与网关",
        "status": "bad"
    },
    "T-HTTP-504": {
        "title": "网关等待上游超时",
        "side": "far",
        "what": "中转等上游模型的回复等太久，先放弃了。这通常是对方那边的时限，插件这边调不了。",
        "steps": [
            "等当前请求结束后再试，不要连续点生成。",
            "持续出现时，可以换一个响应更快的模型，或联系线路提供者。"
        ],
        "group": "服务与网关",
        "status": "bad"
    },
    "T-HTTP-520": {
        "title": "服务器返回了异常状态",
        "side": "far",
        "what": "对方服务器返回了一个不常见的错误状态，没有说明原因。",
        "steps": [
            "稍后再试。",
            "持续出现时，联系线路提供者，并附上出错时间。"
        ],
        "group": "服务与网关",
        "status": "bad"
    },
    "T-HTTP-429": {
        "title": "请求过于频繁，被暂时限流",
        "side": "far",
        "what": "服务商觉得这段时间的请求太多，暂时拒绝了。（独立 API 下，如果服务商要求的等待时间很短，插件会先等一下再自动试一次。）",
        "steps": [
            "等一会儿再生成，不要连续点击。",
            "经常出现的话，看看线路的额度或并发限制。"
        ],
        "group": "限流与额度",
        "status": "warn"
    },
    "T-API-CREDIT-EXHAUSTED": {
        "title": "账户额度不足",
        "side": "settings",
        "what": "服务商提示这个账户的余额或额度已经用完。",
        "steps": [
            "到服务商或中转的账户页面查看余额。",
            "确认当前用的是哪一个 Key / 账户。",
            "额度恢复前，可以先换另一条线路。"
        ],
        "group": "限流与额度",
        "status": "bad"
    },
    "T-API-EMPTY": {
        "title": "模型没有返回正文",
        "side": "far",
        "what": "请求成功了，但回复里没有可以显示的正文，服务商也没有说明原因。",
        "steps": [
            "再生成一次试试。",
            "反复出现时，复制问题信息，问问线路提供者这个模型是否支持当前的接入方式。"
        ],
        "group": "输入与输出",
        "status": "bad"
    },
    "T-API-REASONING-ONLY": {
        "title": "模型只写了思考，没有写正文",
        "side": "content",
        "what": "模型的回复里只有思考过程，没有思考之后的正文。思考内容不会被保存。",
        "steps": [
            "再生成一次试试。",
            "经常这样的话，检查预设是否要求模型在思考结束后输出正文。"
        ],
        "group": "输入与输出",
        "status": "bad"
    },
    "T-API-TRUNCATED": {
        "title": "写到了单次输出上限",
        "side": "content",
        "what": "模型写到了单次能输出的最大长度，就停了下来。",
        "steps": [
            "先看看保留的正文写到了哪里。",
            "开着自动补写的话，插件会按原来的规则接着写。",
            "经常不够长的话，可以在 API 设置里调高“单轮 Max Output Tokens”。"
        ],
        "group": "输入与输出",
        "status": "warn"
    },
    "T-NET-NO-RESPONSE": {
        "title": "连不上服务器",
        "side": "net",
        "what": "请求发出去后，一直没有收到对方的回应。可能是网络断了、地址填错，或者浏览器拦下了这个请求。",
        "steps": [
            "检查网络是否正常。",
            "同一个模型用酒馆主 API 能生成的话，可以先用主 API。",
            "复制问题信息，发给线路提供者或小克。"
        ],
        "group": "连接与等待",
        "status": "bad"
    },
    "T-NET-STREAM-INTERRUPTED": {
        "title": "生成途中连接中断",
        "side": "net",
        "what": "模型已经开始回复，但内容传回来的途中连接断开了。可能是网络晃了一下，也可能是中转那边断开了连接。",
        "steps": [
            "先看看保留下来的正文，确认写到了哪里。",
            "想重写就再生成一次。",
            "经常断的话，在设置里把“流式实时显示”关掉试一次，对比看看。"
        ],
        "group": "连接与等待",
        "status": "bad"
    },
    "T-NET-BODY-INTERRUPTED": {
        "title": "接收回复时连接中断",
        "side": "net",
        "what": "对方已经开始回复，但在接收完整内容时连接断开了。",
        "steps": [
            "稍后再试。",
            "反复出现的话，先用确认能正常生成的线路。"
        ],
        "group": "网络与连接",
        "status": "bad"
    },
    "T-NET-FAILED": {
        "title": "网络连接没有完成",
        "side": "net",
        "what": "请求或接收的过程中网络出了问题，暂时分不清是哪一步。",
        "steps": [
            "检查网络后再试。",
            "主 API 正常的话，可以先用主 API。"
        ],
        "group": "网络与连接",
        "status": "bad"
    },
    "T-NET-TIMEOUT": {
        "title": "等待回复超时",
        "side": "net",
        "what": "等了很久都没有等到回复（或者回复中途停住），插件不再继续等了。",
        "steps": [
            "先看看有没有已经保留的正文。",
            "等当前请求结束后再试。",
            "经常超时的话，可以换一个响应更快的模型或线路。"
        ],
        "group": "连接与等待",
        "status": "bad"
    },
    "T-HTTP-4XX": {
        "title": "服务商拒绝了这次请求",
        "side": "settings",
        "what": "服务商不接受这次请求，常见原因是 Key、模型名或请求设置不符合它的要求。",
        "steps": [
            "核对 API 预设里的地址、模型名和 Key。",
            "复制问题信息，发给线路提供者或小克。"
        ],
        "group": "模型与地址",
        "status": "bad"
    },
    "T-HTTP-400": {
        "title": "服务商拒绝了这次请求",
        "side": "settings",
        "what": "服务商说请求有问题，但没有说明是哪里。",
        "steps": [
            "先不要大改预设或世界书。",
            "核对所选渠道、模型名和接入类型。",
            "复制问题信息继续排查。"
        ],
        "group": "消息与参数",
        "status": "bad"
    },
    "T-HTTP-401": {
        "title": "API 密钥未通过验证",
        "side": "settings",
        "what": "对方服务器说这个 API Key 不对、已经过期，或者没有权限。",
        "steps": [
            "打开 设置 → 当前用的 API 预设，看看 Key 有没有填错、有没有多复制了空格。",
            "刚换过 Key 的话，重新粘贴一遍并保存。",
            "Key 不要发给别人，也不要截进图里。"
        ],
        "group": "认证与权限",
        "status": "bad"
    },
    "T-HTTP-403": {
        "title": "没有访问权限",
        "side": "settings",
        "what": "服务商拒绝了访问。可能是这个 Key 不能用这个模型，或者账户、地区受到限制。",
        "steps": [
            "确认这个 Key 或账户能使用所选模型。",
            "看看服务商有没有地区或实名方面的要求。"
        ],
        "group": "认证与权限",
        "status": "bad"
    },
    "T-HTTP-404": {
        "title": "找不到接口或模型",
        "side": "settings",
        "what": "服务商说要找的东西不存在，通常是接口地址或模型名填错了。",
        "steps": [
            "核对 API 预设里的接口地址。",
            "核对模型名是否完整、拼写是否正确。"
        ],
        "group": "模型与地址",
        "status": "bad"
    },
    "T-HTTP-422": {
        "title": "请求设置未通过检查",
        "side": "settings",
        "what": "服务商认为请求里的某项设置不合规，但没有说明是哪一项。",
        "steps": [
            "核对模型名和 API 预设里的各项设置。",
            "复制问题信息继续排查。"
        ],
        "group": "消息与参数",
        "status": "bad"
    },
    "T-API-CREDENTIAL-AUTH": {
        "title": "服务账号认证失败",
        "side": "settings",
        "what": "酒馆后端报告，服务账号（JSON 凭证）认证没有通过。",
        "steps": [
            "确认酒馆里用的是同一份服务账号凭证。",
            "检查凭证是否有效、项目是否正确。",
            "酒馆自己也认证失败的话，先在酒馆里处理凭证。"
        ],
        "group": "认证与权限",
        "status": "bad"
    },
    "T-API-CREDENTIAL-CHANGED": {
        "title": "绑定的凭证已变更",
        "side": "settings",
        "what": "酒馆当前的凭证和这个 API 预设里保存的不是同一份。",
        "steps": [
            "打开这个 Vertex API 预设。",
            "点“使用酒馆已有凭证”，确认后保存。"
        ],
        "group": "认证与权限",
        "status": "bad"
    },
    "T-API-MODEL-UNAVAILABLE": {
        "title": "所选模型在这条线路上不可用",
        "side": "settings",
        "what": "服务商说这个模型在当前线路或地区用不了。",
        "steps": [
            "核对模型名，不要混用别家平台的模型名。",
            "Vertex 等分地区的渠道，要核对模型的可用地区。"
        ],
        "group": "模型与地址",
        "status": "bad"
    },
    "T-API-PARAMETER-UNSUPPORTED": {
        "title": "模型不支持某项请求设置",
        "side": "settings",
        "what": "服务商说请求里有它不认识或不支持的设置项。不需要删改创作内容。",
        "steps": [
            "记下当前的渠道和模型。",
            "复制问题信息，发给小克，以便核对是哪一项设置不兼容。"
        ],
        "group": "消息与参数",
        "status": "bad"
    },
    "T-API-MESSAGE-END": {
        "title": "模型不接受以“助手消息”结尾的请求",
        "side": "settings",
        "what": "当前模型不支持在请求末尾预填助手的话（助手预填）。",
        "steps": [
            "预设内容不用删。",
            "需要助手预填时，换一个支持它的模型或线路。"
        ],
        "group": "消息与参数",
        "status": "bad"
    },
    "T-API-CONFIG": {
        "title": "连接设置还没填完整",
        "side": "settings",
        "what": "发送前检查发现，缺少地址、模型、Key 或主 API 的选择。",
        "steps": [
            "打开当前用的 API 预设，补齐提示的内容。",
            "保存后点“测试连接”试一下。"
        ],
        "group": "模型与地址",
        "status": "bad"
    },
    "T-AUTO-NO-INSTRUCTION": {
        "title": "自动模式没有可用的指令",
        "side": "settings",
        "what": "自动模式到了该生成的楼层，但指令来源是空的，所以这次没有发出请求。",
        "steps": [
            "先手动生成一次，保存“上次使用的指令”。",
            "或者把自动模式的指令来源换成有内容的模板。"
        ],
        "group": "模型与地址",
        "status": "warn"
    },
    "T-API-INVALID-RESPONSE": {
        "title": "返回内容无法识别",
        "side": "settings",
        "what": "收到的回复不是插件认识的接口格式，比如返回了一个网页。常见原因是接口地址填成了网站首页，或协议选择不对。",
        "steps": [
            "确认接口地址指向 API，而不是网站首页。",
            "核对 API 预设里的协议选择。"
        ],
        "group": "输入与输出",
        "status": "bad"
    },
    "T-API-CONTENT-FILTER": {
        "title": "内容被服务商拦截",
        "side": "content",
        "what": "服务商的安全规则拦下了这次请求。被拦的原因可能在预设、角色卡、聊天记录或世界书里的任何一处，不一定是这次的指令。",
        "steps": [
            "在诊断页的“最近请求摘要”里，看看这次带上了哪些资料。",
            "认为是误拦的话，复制问题信息反馈给线路提供者。"
        ],
        "group": "输入与输出",
        "status": "bad"
    },
    "T-API-INPUT-LIMIT": {
        "title": "发送的内容超出上限",
        "side": "content",
        "what": "这次带上的资料太多，超出了模型能接收的长度。插件没有自动删减任何内容。",
        "steps": [
            "在诊断页看看这次带了多少聊天记录、预设和世界书。",
            "减少不必要的部分，或换一个能接收更长内容的模型。"
        ],
        "group": "输入与输出",
        "status": "bad"
    },
    "T-API-CONTEXT-LIMIT": {
        "title": "内容加输出超出模型容量",
        "side": "content",
        "what": "带上的资料加上预留的输出长度，超过了模型的总容量。插件没有自动删减任何内容。",
        "steps": [
            "减少带上的聊天记录或世界书。",
            "或在 API 设置里调低“单轮 Max Output Tokens”。"
        ],
        "group": "输入与输出",
        "status": "bad"
    },
    "T-API-OUTPUT-LIMIT": {
        "title": "单次输出上限设置过高",
        "side": "content",
        "what": "服务商不接受当前的“单轮 Max Output Tokens”设置，插件自动调低后重试也没有成功。你的原设置没有被改动。",
        "steps": [
            "在 API 设置里调低“单轮 Max Output Tokens”。",
            "不确定上限是多少的话，问问线路提供者。"
        ],
        "group": "输入与输出",
        "status": "bad"
    },
    "T-API-TOKEN-LIMIT": {
        "title": "输出或上下文长度超出限制",
        "side": "content",
        "what": "模型不接受当前的输出长度，或者带上的资料太多，塞满了上下文。",
        "steps": [
            "先减少聊天记录和不必要的世界书。",
            "再考虑调低目标字数或“单轮 Max Output Tokens”。"
        ],
        "group": "输入与输出",
        "status": "bad"
    },
    "T-RENDER-INVALID": {
        "title": "正文已完成，排版没有通过检查",
        "side": "local",
        "what": "正文已经写好并保留，只是排成网页时缺段或不完整。",
        "steps": [
            "先看保留下来的纯文字正文。",
            "需要的话点“重新排版”，或换一个排版模板。不用重新生成整篇。"
        ],
        "group": "排版与保存",
        "status": "warn"
    },
    "T-STORAGE-WRITE": {
        "title": "本地保存没有完成",
        "side": "local",
        "what": "这次的内容没能存进浏览器的本地存档。",
        "steps": [
            "先复制或导出眼前还能看到的正文。",
            "暂时不要清浏览器数据、重装插件或覆盖旧存档。",
            "复制问题信息，发给小克。"
        ],
        "group": "排版与保存",
        "status": "bad"
    },
    "T-UNKNOWN": {
        "title": "暂时无法判断的问题",
        "side": "unknown",
        "what": "现有的信息不足以判断是哪里出了问题。",
        "steps": [
            "先保留页面上还能看到的正文。",
            "复制问题信息，并记下刚才做了什么操作。",
            "不要反复清数据或一次改很多设置。"
        ],
        "group": "其他情况",
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
