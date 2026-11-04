// Independent upstream oracle, extracted unchanged functions from SillyTavern 1.15.0.
// https://github.com/SillyTavern/SillyTavern/blob/1.15.0/src/prompt-converters.js
// Upstream license: AGPL-3.0. Only stock constants/imports are supplied here;
// tests use synthetic text messages, no tool or multimodal generation.
import crypto from 'node:crypto';
const PROMPT_PLACEHOLDER = "Let's get started.";
const GEMINI_MEDIA_RESOLUTION = { low: 'media_resolution_low', medium: 'media_resolution_medium', high: 'media_resolution_high' };
export function mergeMessages(messages, names, { strict = false, placeholders = false, single = false, tools = false } = {}) {
    let mergedMessages = [];

    /** @type {Map<string,object>} */
    const contentTokens = new Map();

    // Remove names from the messages
    messages.forEach((message) => {
        if (!message.content) {
            message.content = '';
        }
        // Flatten contents and replace image URLs with random tokens
        if (Array.isArray(message.content)) {
            const text = message.content.map((content) => {
                if (content.type === 'text') {
                    return content.text;
                }
                // Could be extended with other non-text types
                if (['image_url', 'video_url', 'audio_url'].includes(content.type)) {
                    const token = crypto.randomBytes(32).toString('base64');
                    contentTokens.set(token, content);
                    return token;
                }
                return '';
            }).join('\n\n');
            message.content = text;
        }
        if (message.role === 'system' && message.name === 'example_assistant') {
            if (names.charName && !message.content.startsWith(`${names.charName}: `) && !names.startsWithGroupName(message.content)) {
                message.content = `${names.charName}: ${message.content}`;
            }
        }
        if (message.role === 'system' && message.name === 'example_user') {
            if (names.userName && !message.content.startsWith(`${names.userName}: `)) {
                message.content = `${names.userName}: ${message.content}`;
            }
        }
        if (message.name && message.role !== 'system') {
            if (!message.content.startsWith(`${message.name}: `)) {
                message.content = `${message.name}: ${message.content}`;
            }
        }
        if (message.role === 'tool' && !tools) {
            message.role = 'user';
        }
        if (single) {
            if (message.role === 'assistant') {
                if (names.charName && !message.content.startsWith(`${names.charName}: `) && !names.startsWithGroupName(message.content)) {
                    message.content = `${names.charName}: ${message.content}`;
                }
            }
            if (message.role === 'user') {
                if (names.userName && !message.content.startsWith(`${names.userName}: `)) {
                    message.content = `${names.userName}: ${message.content}`;
                }
            }

            message.role = 'user';
        }
        delete message.name;
        if (!tools) {
            delete message.tool_calls;
            delete message.tool_call_id;
        }
    });

    // Squash consecutive messages with the same role
    messages.forEach((message) => {
        if (mergedMessages.length > 0 && mergedMessages[mergedMessages.length - 1].role === message.role && message.content && message.role !== 'tool') {
            mergedMessages[mergedMessages.length - 1].content += '\n\n' + message.content;
        } else {
            mergedMessages.push(message);
        }
    });

    // Prevent erroring out if the mergedMessages array is empty.
    if (mergedMessages.length === 0) {
        mergedMessages.unshift({
            role: 'user',
            content: PROMPT_PLACEHOLDER,
        });
    }

    // Check for content tokens and replace them with the actual content objects
    if (contentTokens.size > 0) {
        mergedMessages.forEach((message) => {
            const hasValidToken = Array.from(contentTokens.keys()).some(token => message.content.includes(token));

            if (hasValidToken) {
                const splitContent = message.content.split('\n\n');
                const mergedContent = [];

                splitContent.forEach((content) => {
                    if (contentTokens.has(content)) {
                        mergedContent.push(contentTokens.get(content));
                    } else {
                        if (mergedContent.length > 0 && mergedContent[mergedContent.length - 1].type === 'text') {
                            mergedContent[mergedContent.length - 1].text += `\n\n${content}`;
                        } else {
                            mergedContent.push({ type: 'text', text: content });
                        }
                    }
                });

                message.content = mergedContent;
            }
        });
    }

    if (strict) {
        for (let i = 0; i < mergedMessages.length; i++) {
            // Force mid-prompt system messages to be user messages
            if (i > 0 && mergedMessages[i].role === 'system') {
                mergedMessages[i].role = 'user';
            }
        }
        if (mergedMessages.length && placeholders) {
            if (mergedMessages[0].role === 'system' && (mergedMessages.length === 1 || mergedMessages[1].role !== 'user')) {
                mergedMessages.splice(1, 0, { role: 'user', content: PROMPT_PLACEHOLDER });
            }
            else if (mergedMessages[0].role !== 'system' && mergedMessages[0].role !== 'user') {
                mergedMessages.unshift({ role: 'user', content: PROMPT_PLACEHOLDER });
            }
        }
        return mergeMessages(mergedMessages, names, { strict: false, placeholders, single: false, tools });
    }

    return mergedMessages;
}

export function convertGooglePrompt(messages, model, useSysPrompt, names) {
    const sysPrompt = [];

    if (useSysPrompt) {
        while (messages.length > 1 && messages[0].role === 'system') {
            // Append example names if not already done by the frontend (e.g. for group chats).
            if (names.userName && messages[0].name === 'example_user') {
                if (!messages[0].content.startsWith(`${names.userName}: `)) {
                    messages[0].content = `${names.userName}: ${messages[0].content}`;
                }
            }
            if (names.charName && messages[0].name === 'example_assistant') {
                if (!messages[0].content.startsWith(`${names.charName}: `) && !names.startsWithGroupName(messages[0].content)) {
                    messages[0].content = `${names.charName}: ${messages[0].content}`;
                }
            }
            sysPrompt.push(messages[0].content);
            messages.shift();
        }
    }

    const system_instruction = { parts: sysPrompt.map(text => ({ text })) };
    const toolNameMap = {};

    const contents = [];
    messages.forEach((message, index) => {
        // fix the roles
        if (message.role === 'system' || message.role === 'tool') {
            message.role = 'user';
        } else if (message.role === 'assistant') {
            message.role = 'model';
        }

        // Convert the content to an array of parts
        if (!Array.isArray(message.content)) {
            const content = (() => {
                const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
                const hasToolCallId = typeof message.tool_call_id === 'string' && message.tool_call_id.length > 0;

                if (hasToolCalls) {
                    return { type: 'tool_calls', tool_calls: message.tool_calls };
                }

                if (hasToolCallId) {
                    return { type: 'tool_call_id', tool_call_id: message.tool_call_id, content: String(message.content ?? '') };
                }

                return { type: 'text', text: String(message.content ?? '') };
            })();
            message.content = [content];
        }

        // similar story as claude
        if (message.name) {
            message.content.forEach((part) => {
                if (part.type !== 'text') {
                    return;
                }
                if (message.name === 'example_user') {
                    if (names.userName && !part.text.startsWith(`${names.userName}: `)) {
                        part.text = `${names.userName}: ${part.text}`;
                    }
                } else if (message.name === 'example_assistant') {
                    if (names.charName && !part.text.startsWith(`${names.charName}: `) && !names.startsWithGroupName(part.text)) {
                        part.text = `${names.charName}: ${part.text}`;
                    }
                } else {
                    if (!part.text.startsWith(`${message.name}: `)) {
                        part.text = `${message.name}: ${part.text}`;
                    }
                }
            });

            delete message.name;
        }

        //create the prompt parts
        const parts = [];
        message.content.forEach((part) => {
            const addDataUrlPart = (/** @type {string} */ url, /** @type {string} */ defaultMimeType, /** @type {string?} */ detail = null) => {
                if (url && url.startsWith('data:')) {
                    const [header, base64Data] = url.split(',');
                    const mimeType = header.match(/data:([^;]+)/)?.[1] || defaultMimeType;
                    const mediaResolution = GEMINI_MEDIA_RESOLUTION[detail] || null;

                    const part = {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data,
                        },
                    };

                    // https://ai.google.dev/gemini-api/docs/gemini-3#media_resolution
                    if (/gemini-3/.test(model) && mediaResolution) {
                        part.mediaResolution = {
                            level: mediaResolution,
                        };
                    }

                    parts.push(part);
                }
            };

            if (part.type === 'text') {
                parts.push({ text: part.text });
            } else if (part.type === 'tool_call_id') {
                const name = toolNameMap[part.tool_call_id] ?? 'unknown';
                parts.push({
                    functionResponse: {
                        name: name,
                        response: { name: name, content: part.content },
                    },
                });
            } else if (part.type === 'tool_calls') {
                part.tool_calls.forEach((toolCall) => {
                    parts.push({
                        functionCall: {
                            name: toolCall.function.name,
                            args: tryParse(toolCall.function.arguments) ?? toolCall.function.arguments,
                        },
                        ...(toolCall.signature ? { thoughtSignature: toolCall.signature } : {}),
                    });

                    toolNameMap[toolCall.id] = toolCall.function.name;
                });
            } else if (part.type === 'image_url') {
                const imageUrl = part.image_url?.url;
                const detail = part.image_url?.detail;
                addDataUrlPart(imageUrl, 'image/png', detail);
            } else if (part.type === 'video_url') {
                const videoUrl = part.video_url?.url;
                const detail = part.video_url?.detail;
                addDataUrlPart(videoUrl, 'video/mp4', detail);
            } else if (part.type === 'audio_url') {
                const audioUrl = part.audio_url?.url;
                addDataUrlPart(audioUrl, 'audio/mpeg');
            }
        });

        // https://ai.google.dev/gemini-api/docs/gemini-3#migrating_from_other_models
        // Inject stored thought signatures, or fall back to bypass magic for Gemini 3
        if (/gemini-3/.test(model) || /gemini-2\.5/.test(model)) {
            const skipSignatureMagic = 'skip_thought_signature_validator';
            const textSignature = message.signature;

            parts.forEach((part) => {
                if (textSignature && typeof part.text === 'string') {
                    part.thoughtSignature = textSignature;
                } else if (/gemini-3/.test(model)) {
                    // Gemini 3: Fall back to bypass magic for function calls (mandatory) and images
                    if (part.functionCall && !part.thoughtSignature) {
                        part.thoughtSignature = skipSignatureMagic;
                    }
                    if (/-image/.test(model) && message.role === 'model') {
                        if (typeof part.text === 'string' || part.inlineData) {
                            part.thoughtSignature = skipSignatureMagic;
                        }
                    }
                }
                // Gemini 2.5 without stored signatures: signatures are optional, no bypass needed
            });
        }

        // merge consecutive messages with the same role
        if (index > 0 && message.role === contents[contents.length - 1].role) {
            parts.forEach((part) => {
                if (part.text) {
                    const textPart = contents[contents.length - 1].parts.find(p => typeof p.text === 'string');
                    if (textPart) {
                        textPart.text += '\n\n' + part.text;
                    } else {
                        contents[contents.length - 1].parts.push(part);
                    }
                }
                if (part.inlineData || part.functionCall || part.functionResponse || part.thoughtSignature || part.mediaResolution) {
                    contents[contents.length - 1].parts.push(part);
                }
            });
        } else {
            contents.push({
                role: message.role,
                parts: parts,
            });
        }
    });

    return { contents: contents, system_instruction: system_instruction };
}

export function nativeStrict(messages) {
    return mergeMessages(structuredClone(messages), { charName: '', userName: '', startsWithGroupName: () => false }, { strict: true, placeholders: true, tools: false });
}
