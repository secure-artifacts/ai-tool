/**
 * AI 语义分类服务
 *
 * 基于 SKILL.md 的三层分类体系（8大类 + 68中类 + 100+小类），
 * 调用 Gemini API 对信仰类短视频文案进行语义分类。
 */
import { GoogleGenAI } from "@google/genai";
import { shouldUseAiStudioMode } from '../../../utils/aiStudioDetect';

// ==================== 类型 ====================

export interface AiClassifyItem {
    index: number;
    originalRowIndex?: number;
    text: string;
    zhText: string;
    enText: string;
}

export interface AiClassifyResult {
    index: number;
    originalRowIndex?: number;
    text: string;
    zhText: string;
    enText: string;
    major: string;
    middle: string;
    minor: string;
    customCategories?: Record<string, string>;
    confidence: number;
    isManual: boolean;
}

export interface AiClassifyProgress {
    current: number;
    total: number;
    status: string;
}

// ==================== 大类颜色映射 ====================

export const MAJOR_CATEGORY_COLORS: Record<string, string> = {
    '无效内容': '#94a3b8',
    '数字排比': '#06b6d4',
    '经文短贴': '#3b82f6',
    '经文长贴': '#8b5cf6',
    '简短祷告': '#f59e0b',
    '祷告词长': '#ef4444',
    '口播文案': '#eab308',
    '宗派小话': '#22c55e',
    '其他': '#6b7280',
};

// ==================== AI 实例获取 ====================

function getAiInstance(): GoogleGenAI {
    // 优先使用全局暴露的带自动轮换的实例
    if (typeof window !== 'undefined' && (window as any).__app_get_ai_instance) {
        return (window as any).__app_get_ai_instance();
    }
    // 回退：自行创建实例
    const storedKey = typeof window !== 'undefined' ? localStorage.getItem('user_api_key') : null;
    const keyToUse = storedKey || process.env.API_KEY;
    if (!keyToUse) {
        throw new Error('API key 未设置。请先在顶部配置 Google AI API Key。');
    }
    const cleanKey = keyToUse.trim().replace(/[^\x20-\x7E]/g, '');
    if (shouldUseAiStudioMode(cleanKey)) {
        return new GoogleGenAI({ apiKey: cleanKey });
    }
    return new GoogleGenAI({ apiKey: cleanKey, vertexai: true });
}

// ==================== System Prompt ====================

export const CLASSIFY_SYSTEM_PROMPT = `你是一名**信仰类短视频文案分类专家**。

## 任务
逐条阅读用户提供的文案，按照判断流程确定**大类**（文案类型），根据内容语义确定**小类**（内容细节），从小类自动推导**中类**（主题方向）。

> ⚠️ 这是**语义分类**，不是关键词匹配。根据文案整体内容、语气、结构和意图判断。

## 一、大类（9个）— 按格式/结构判断

| 大类 | 判断标准 |
|------|---------|
| **无效内容** | 与基督信仰无关，或无实际意义的内容（纯hashtag、纯CTA、乱码、广告、非信仰话题等） |
| **数字排比** | 有数字编号（1. 2. 3.… 或 第一、第二、第三…）作为主体结构。必须有编号，纯排比不算 |
| **经文短贴** | 有圣经经文引用（书卷+章节号）+ 对应英文≤400字符 |
| **经文长贴** | 有圣经经文引用（书卷+章节号）+ 对应英文>400字符 |
| **简短祷告** | 对神说话（祷告体）+ 对应英文≤400字符 |
| **祷告词长** | 对神说话（祷告体）+ 对应英文>400字符 |
| **口播文案** | 有叙事结构，像人在讲话，适合出镜念 + 对应英文>400字符 |
| **宗派小话** | 以上都不是 + 对应英文≤400字符 |
| **其他** | 以上都不是 + 对应英文>400字符 |

**判断顺序**（命中即停）：
第0步 → 是否为有效信仰内容？ → 不是 → 无效内容
第1步 → 有数字编号？ → 数字排比（检查副特征，见下方）
第2步 → 有经文引用？ → 经文短贴/经文长贴（检查副特征，见下方）
第3步 → 祷告体？ → 简短祷告/祷告词长
第4步 → 叙事口播？ → 口播文案
第5步 → 剩余：短→宗派小话，长→其他

> ⚠️ **字数计算（必读）**：
>
> 所有的长度区分（「短」与「长」的界限）**必须统一通过英文的 400 字符为分水岭**！
> **如果输入的文案是中文，请先在内部（脑海中）将其翻译成对应的英文，然后判断这段英文是否超过了 400 个字符的长度。**
> - 判断结果 ≤400 英文单词字符：就是短贴、简短祷告、宗派小话。
> - 判断结果 >400 英文单词字符：就是长贴、长祷告、口播文案、其他。

> ⚠️ **第0步 — 无效内容判断**：
>
> 以下情况直接归为**无效内容**，不进入后续分类：
> - 纯hashtag，没有正文内容
> - 纯CTA，无实际信仰内容（如仅"阿门阿门"、"输入777"）
> - 纯图片说明（如"图片来自AI"、"照片来源网络"）
> - 乱码、机翻垃圾、无意义文字堆砌
> - 完全与基督信仰无关的内容（广告、营销、其他话题）

> ⚠️ **第1步 — 数字排比副特征标注**：
>
> 命中数字编号后，还需检查文案是否**同时具有祷告体或经文引用**，用括号标注：
> - 数字排比 — 纯数字列表，无副特征
> - 数字排比（祷告） — 有数字编号 + 主体是对神说话的祷告
> - 数字排比（经文） — 有数字编号 + 含圣经经文引用

> ⚠️ **第2步 — 经文类副特征标注**：
>
> 命中经文引用后，还需检查文案是否**同时具有祷告体或口播特征**，用括号标注：
> - 经文短贴 / 经文长贴 — 纯经文展示，无副特征
> - 经文短贴（祷告） / 经文长贴（祷告） — 有经文引用 + 主体或部分为对神说话的祷告
> - 经文短贴（口播） / 经文长贴（口播） — 有经文引用 + 有叙事结构，适合出镜念

> ⚠️ **祷告体边界说明**：
>
> **判断核心：看主体内容是否有多句对神的真实倾诉，而非只看开头。**
>
> - 社媒祷告词**常带号召结尾**（"请说阿门"、"分享给需要的人"），这是社媒格式特征，**不影响祷告体判定**。关键看**主体部分**。
> - ✅ 归**简短祷告**：主体有多句对神倾诉（如"主啊，没有你我无法独自站立。你是我活下去的理由。没有上帝我什么都不是"），即使结尾有号召CTA。
> - ❌ 归**宗派小话**：只有一句话式的祷告开头+立即转入号召（如"亲爱的上帝 请打开所有的门，给那位说阿门的人"），整体像社媒配图文案。

> ⚠️ **口播文案 vs 宗派小话 边界说明**：
>
> 不能仅凭"语气像人在说话"就判定为口播文案。关键区分：
> - ✅ **口播文案**：有**完整叙事展开**（起承转合），适合出镜口播1-3分钟。如："我曾经历了一段非常黑暗的日子……后来上帝……所以我今天想告诉你……"
> - ❌ **宗派小话**：短 + 宣告/呼吁/祝福，结构是「宣告 + 阿门/分享CTA」，像**社媒图文配文**。虽然读出来也自然，但没有叙事展开。
>
> **常见误判场景**（以下都是宗派小话，不是口播）：
> - 社会评论 + 互动投票：如"上帝毁灭所多玛和蛾摩拉……我们该悔改了……如果你也这么认为，请回答是" ← 是论点+投票，不是叙事
> - 宣告 + CTA：如"我们生活在一个憎恨基督的世界，如果你跟随耶稣，请说阿门" ← 是宣告+号召
> - 排比宣告：如"耶稣指引我。耶稣扶持我。耶稣饶恕我" ← 是排比句式，不是叙事

## 二、中类（64个）— 按内容主题方向判断

> 判断方法：看文案整体**在做什么事/讲什么主题**

| 中类 | 判断标准 |
|------|---------|
| 感恩感谢 | 文案在**表达对神的感谢/感恩** |
| 爱神类 | 文案在**号召表达对上帝/耶稣的爱**——如果你爱上帝说阿门 |
| 信心祷告 | 文案是**关于信心的祷告**——日子很沉重但我信 |
| 依靠神 | 文案在**表达依靠神的力量** |
| 未来、计划 | 文案在**把未来/计划/恐惧交给神** |
| 神帮助/需要上帝 | 文案在**表达需要神帮助、离不开神** |
| 认罪祷告 | 文案在**向神认错、请求赦免** |
| 祈求祷告 | 文案是**向神祈求**——求你更新我、赐予我平安 |
| 神爱你 | 文案在**宣告神爱你** |
| 神没让你失望 | 文案在**强调神从未让你失望/离开** |
| 上帝是好的 | 文案在**宣告上帝是良善的/美好的** |
| 安慰指引 | 文案在**传达神的安慰和引导** |
| 疲惫负担 | 文案在**安慰疲惫的人**——你很累、重担交给神 |
| 解决一切问题 | 文案在**宣告神能解决所有问题** |
| 神保护 | 文案在**宣告神保护你**（笼统的，非特定对象） |
| 拯救类 | 文案在**宣告神拯救**——多次拯救你的生命 |
| 祝福类 | 文案在**传递/宣告祝福** |
| 代祷祝福 | 文案在**为他人代祷和祝福** |
| 七年繁荣 | 文案在**宣告七年的繁荣** |
| 美妙、美好消息 | 文案在**传递好消息/美好的事** |
| 属灵争战宣告——命令撒旦与黑暗势力离开 | 文案在**直接命令撒旦和黑暗势力离开** |
| 属灵争战宣告——宣告十字架已经得胜 | 文案在**宣告十字架已经得胜** |
| 属灵争战宣告——站在神的权柄与真理中 | 文案在**宣告站在神的权柄和真理中** |
| 破除咒诅——打破世代、家族、隐藏的咒诅 | 文案在**打破世代/家族/隐藏的咒诅** |
| 破除咒诅——摧毁仇敌陷阱、反击仇敌攻击 | 文案在**摧毁仇敌的陷阱和计划** |
| 破除咒诅——取消邪恶言语 | 文案在**取消/废除邪恶的言语和咒诅** |
| 咒诅被打破 | 文案在**宣告咒诅已被打破**（结果宣告） |
| 宝血遮盖 | 文案在**宣告耶稣宝血遮盖保护** |
| 家人保护 | 文案在**笼统地为家人祈求保护** |
| 家庭保护——免受灵界攻击 | 文案在**为家庭抵挡灵界/属灵攻击** |
| 家庭保护——免受咒诅与邪恶言语 | 文案在**为家庭抵挡咒诅和邪恶言语** |
| 家庭保护——抵挡疾病、混乱与灾害 | 文案在**为家庭抵挡疾病和灾害** |
| 个人保护——抵挡黑暗攻击与属灵压迫 | 文案在**为自己抵挡黑暗攻击和属灵压迫** |
| 个人保护——保护思想、心灵与情绪 | 文案在**保护自己的思想、心灵和情绪** |
| 孩子保护——保护思想、情绪与心灵 | 文案在**为孩子保护思想和情绪** |
| 孩子保护——在学校、家庭与未来蒙保守 | 文案在**为孩子在学校和未来祈求保护** |
| 孩子保护——打破叛逆与成瘾 | 文案在**为孩子打破叛逆和成瘾** |
| 耶稣王 | 文案在**宣告耶稣的身份/权柄**——"耶稣是___" |
| 主再来 | 文案在**宣告主/耶稣会再来**（未来事件） |
| 回归上帝 | 文案在**呼吁回归上帝/把神放首位** |
| 信心/考验 | 文案关于**信心和考验** |
| 计划/时机 | 文案关于**神的计划和时机**（含神的时间安排） |
| 鼓励 | 文案是**鼓励性的** |
| 医治 | 文案关于**医治** |
| 争战/开路 | 文案关于**争战和开路** |
| 打开门 | 文案关于**神打开门** |
| 祈祷 | 文案关于**祈祷** |
| 女性 | 文案**面向女性** |
| 与神的关系 | 文案关于**与神的关系** |
| 某些东西来自上帝 | 文案关于**属于你的来自上帝** |
| 你会哭泣，不是因为有人伤害你 | 文案关于**你会哭泣但神回应** |
| 玫瑰花-圣母 | 文案涉及**圣母玛利亚+玫瑰** |
| 玫瑰花-安东尼 | 文案涉及**圣安东尼+玫瑰** |
| 感谢玛利亚+祝福 | 文案在**感谢圣母+传递祝福** |
| 玛利亚拜访 | 文案关于**圣母拜访** |
| 圣布里吉德+祝福 | 文案涉及**圣布里吉德+祝福** |
| 填空类 | 文案是**填空/互动/问答形式** |
| 神、耶稣排比 | 文案用**排比句式**写耶稣/上帝（无数字编号） |
| 删除三件事 | 文案是**"删除三件事"格式** |
| 数字-7件事、5个原因等 | 文案是**数字列表形式**——N件事/N个原因 |
| 圣经书 | 文案关于**圣经书卷本身** |
| 寓意类 | 文案用**寓意/比喻**表达 |
| 睡前 | 文案是**睡前场景**的内容 |
| 其他类 | **以上都不是** |

## 三、小类 — 按内容细节判断

> 小类自然归属中类，不需手动指定

### 感恩感谢
| 小类 | 判断 |
|------|------|
| 感谢上帝 | 叫观众停下来感谢上帝 |
| 感恩祷告 | 对神说的感恩祷告 |
| 个人经历感恩 | 回顾个人经历后感恩——高潮低谷、顺境逆境 |
| 启动贴 | 早上醒来就感恩——"我醒了，我选择感恩" |
| 归功于上帝 | 把自己的成就归功于上帝 |
| 个人感恩 | 个人向神说谢谢——"让我得以生存" |
| 感谢挣扎 | 感谢神让经历的每一次挣扎 |

### 爱神类
| 小类 | 判断 |
|------|------|
| 爱上帝 | "如果你爱上帝"、"真正爱他的人" |
| 爱十字架上的耶稣 | 爱那位死在十字架上的人 |
| 我爱耶稣 | 直接宣告"我爱耶稣" |
| 爱钱胜过爱上帝 | 批评爱钱胜过爱上帝 |
| 不写"我爱耶稣" | "很多人不敢写我爱耶稣" |
| 耶稣是我的 | 个人归属宣告——"耶稣是我的主/一切" |

### 信心祷告
| 小类 | 判断 |
|------|------|
| 信心 | 信心能移山、与神同行 |
| 信上帝 | 宣告信奉上帝 |
| 个人见证 | 个人信心经历——"没有上帝的帮助我不会…" |

### 未来、计划
| 小类 | 判断 |
|------|------|
| 害怕未来 | 表达对未来的恐惧但交给神 |
| 焦虑交托 | 忧虑袭来时转向神 |

### 神帮助/需要上帝
| 小类 | 判断 |
|------|------|
| 上帝，我需要你 | 直接说"每时每刻都需要你" |
| 没有上帝无法活下去 | "没有你我什么都不是"、无法独自站立 |
| 生活不易，我不放弃 | 生活很艰难但有神所以不放弃 |

### 认罪祷告
| 小类 | 判断 |
|------|------|
| 简短认罪感恩 | 简短的认罪——"我犯了很多错" |
| 悔改 | 呼吁悔改——"悔改是进入天国" |
| 悔改归向神 | 离弃恶行、归向上帝 |

### 祈求祷告
| 小类 | 判断 |
|------|------|
| 祈求排比 | 用排比形式祈求——"请赐予我安宁/照亮我心中" |
| 如果式祈求排比 | "如果我软弱，求你赐我力量" |
| 祷告开启新月份 | 为新的月份祈求 |
| 4个改变你人生的祷告 | 关于改变人生的祷告 |

### 神爱你
| 小类 | 判断 |
|------|------|
| 神同在 | 宣告神2026年与你同在 |
| 从未让你失望 | 宣告神从未让你失望、从未离开 |
| 上帝永远不会放弃你 | 宣告上帝永远不会放弃你 |
| 天使已被差遣来安慰你 | 天使已被差遣来安慰你 |

### 安慰指引
| 小类 | 判断 |
|------|------|
| 安慰-神要擦干你的眼泪 | 神要擦干你的眼泪、内心崩溃的日子 |
| 不要独自承受重担 | 不要独自承担重担 |
| 上帝知你累-争战-开路 | 上帝知道你很累，会为你开路 |

### 疲惫负担
| 小类 | 判断 |
|------|------|
| 疲惫重担 | 挪去生命中的忧虑和重担 |

### 解决一切问题
| 小类 | 判断 |
|------|------|
| 所有的问题 | 解决所有问题 |

### 神保护
| 小类 | 判断 |
|------|------|
| 上帝是你存活的原因 | 你能活着是因为上帝保护 |
| 庇护家人 | 笼统地祈求上帝庇佑家人 |

### 拯救类
| 小类 | 判断 |
|------|------|
| 神拯救 | 多次拯救你的生命 |
| 耶稣为你流血 | 耶稣为你牺牲、流血 |

### 祝福类
| 小类 | 判断 |
|------|------|
| 三项祝福 | 愿你的眼泪化为笑容等三项祝福 |
| 好事发生在 | 好事将要发生在你身上 |
| 3个奇迹 | 三个奇迹/三样祝福 |
| 3遍奇迹祷告 | 读三遍就会有奇迹的祷告 |
| 上帝的五个祝福 | 列出上帝的五个祝福 |

### 属灵争战宣告——命令撒旦与黑暗势力离开
| 小类 | 判断 |
|------|------|
| 撒但/耶稣 | "如果你爱撒旦请跳过"的对比形式 |
| 战胜黑暗势力 | 战胜一切黑暗势力、打破锁链 |
| 属灵争战-个人 | 为个人驱赶黑暗 |
| 属灵争战-家人 | 为家人驱赶黑暗 |

### 破除咒诅——打破世代、家族、隐藏的咒诅
| 小类 | 判断 |
|------|------|
| 每一个咒诅都被打破 | 宣告每一个咒诅都被打破 |

### 家人保护
| 小类 | 判断 |
|------|------|
| 为孩子祈祷 | 为孩子祈祷保护 |
| 女儿祷告 | 专门为女儿祷告 |

### 孩子保护——保护思想、情绪与心灵
| 小类 | 判断 |
|------|------|
| 属灵争战-孩子 | 为孩子进行属灵争战 |

### 耶稣王
| 小类 | 判断 |
|------|------|
| 是王 | 宣告"仍然是王" |
| 他是我们的王 | 宣告"他是我们的王" |
| 君王会再来 | 宣告君王会再来 |
| 通往天堂的唯一道路 | 耶稣是通往天堂的唯一道路 |
| 耶稣基督是救主 | 宣告耶稣基督是救主 |
| 见证耶稣基督救主 | 号召见证耶稣是救主 |
| 耶稣是答案 | 宣告耶稣就是答案 |
| 耶稣不是一个选择 | 耶稣不是可选项而是必须 |
| 憎恨基督的世界 | 世界憎恨基督但我们仍跟随 |

### 主再来
| 小类 | 判断 |
|------|------|
| 二次降临 | 救主的第二次降临 |
| 质量-耶稣再来 | 耶稣会再来 |
| 生命册 | 名字写在生命册上（末世审判） |

### 回归上帝
| 小类 | 判断 |
|------|------|
| 与神关系首位 | 把神放在生命首位 |
| 神放在首位 | 首位、第一位 |
| 与耶稣基督的关系 | 与耶稣基督建立关系 |

### 信心/考验
| 小类 | 判断 |
|------|------|
| 信靠走出困境 | 信靠神走出困境 |
| 不必独立面对争战 | 不用独自面对 |

### 计划/时机
| 小类 | 判断 |
|------|------|
| 属于你的无需祈求 | 属于你的无需费力，神的旨意 |
| 没人阻止上帝成就的事 | 没有人能阻止上帝即将成就的事 |
| 上帝仍然掌管一切 | 上帝仍然掌管一切 |
| 神成就任何事 | 在任何时间成就任何事 |
| 神成就不可能之事 | 神能成就不可能之事 |
| 神能成就不可能的事 | 神能为任何人成就不可能 |

### 鼓励
| 小类 | 判断 |
|------|------|
| 永远不要失去希望 | 永远不要失去希望 |
| 上帝回应了你的祷告 | 上帝回应了你的祷告 |

### 医治
| 小类 | 判断 |
|------|------|
| 神治愈你的伤痛 | 神治愈身体和心灵的伤痛 |

### 争战/开路
| 小类 | 判断 |
|------|------|
| 开路 | 神为你开路 |
| 上帝知你累-争战-开路 | 上帝知道你很累，正在为你争战开路 |

### 打开门
| 小类 | 判断 |
|------|------|
| 打开所有的门 | 敞开所有门 |
| 打开所有的大门 | 打开所有的大门 |

### 祈祷
| 小类 | 判断 |
|------|------|
| 神垂听祷告 | 当你祷告时神垂听 |

### 女性
| 小类 | 判断 |
|------|------|
| 坚强的女性 | 坚强的女人、屹立不倒 |
| 敬虔的女人 | 敬虔的女人、她祷告 |
| 信靠上帝的女人 | 信靠上帝的女子 |
| 圣经故事女性 | 路得的路等圣经女性故事 |

### 某些东西来自上帝
| 小类 | 判断 |
|------|------|
| 上帝安排好一切 | 上帝安排好一切 |

### 你会哭泣，不是因为有人伤害你
| 小类 | 判断 |
|------|------|
| 你会哭泣神回应 | 你会哭泣不是因为被伤害而是神回应 |

### 玫瑰花-圣母
| 小类 | 判断 |
|------|------|
| 圣母祝福 | 接受圣母的祝福 |

### 玫瑰花-安东尼
| 小类 | 判断 |
|------|------|
| 安东尼祝福 | 圣安东尼今晚会帮助你 |

### 感谢玛利亚+祝福
| 小类 | 判断 |
|------|------|
| 感谢圣母 | 感谢圣母玛利亚、对玛丽说声谢谢 |
| 爱圣母 | 如果你爱圣母玛利亚 |

### 填空类
| 小类 | 判断 |
|------|------|
| 互动类 | 互动形式——"上帝为你做的一___" |
| 问答 | 问答形式——"你会怎么说？" |

### 神、耶稣排比
| 小类 | 判断 |
|------|------|
| 耶稣排比 | 耶稣扶持我/指引我/带领我 |
| 上帝伟大排比 | 上帝比你的过去更伟大 |

### 删除三件事
| 小类 | 判断 |
|------|------|
| 除去三样东西 | 上帝要从你生命中除去三样东西 |

### 数字-7件事、5个原因等
| 小类 | 判断 |
|------|------|
| 六件事、7条信息 | 上帝永远爱你等6-7项内容 |
| 7、8、10、12项祝福 | 你有一个家、你能呼吸等多项祝福 |
| 7个迹象 | 7个迹象 |
| 对上帝说的5、7件事 | 上帝说的七件事/对自己说的5件事 |
| 不忧虑的5个理由 | 5个不忧虑的理由 |
| 我确信的七件事 | 我确信的七件事——生命是恩赐 |
| 早晨3、4件事 | 没有你我什么都不是等早晨事项 |
| 数字-其他 | 其他数字列表内容 |

### 圣经书
| 小类 | 判断 |
|------|------|
| 用神的话语滋养灵魂 | 用神的话语滋养灵魂 |
| 十诫 | 关于十诫内容 |

### 睡前
| 小类 | 判断 |
|------|------|
| 睡前祷告 | 睡前场景的祷告 |

### 其他类
| 小类 | 判断 |
|------|------|
| 纯小话-其他 | 纯小话中不含以上任何类别的 |
| 短祷告-其他 | 短祷告中不含以上任何类别的 |
| 祷告长-其他 | 长祷告中不含以上任何类别的 |
| 是否去教堂 | 无论你是否去教堂 |
| 学校阅读圣经 | 在学校阅读圣经 |
| 过去一个小时 | 过去一个小时 |
| 恢复祈祷活动 | 恢复祈祷活动 |
| 祈祷的力量-灾难 | 祈祷的力量（灾难场景） |
| 重要 | 生活中重要的事 |
| 女性 | 女性相关（非经文类） |
| 更需要上帝 | 世界比以往更需要上帝 |
| 异象-血月 | 月亮要变为血 |
| 伸冤 | 神为你伸冤 |
| 凡事都能 | 大海无法阻挡 |
| 诗篇91篇 | 至高者隐秘处 |
| 耶和华是我的亮光 | 耶和华是我的亮光 |

> ⚠️ 小类是开放的——如果遇到现有列表中没有的内容细节，可以创建新的小类标签，但必须归属到正确的中类下。

## 四、输出格式

严格要求 JSON 格式输出：

\`\`\`json
{
  "results": [
    {
      "index": 1,
      "major": "大类名称",
      "middle": "中类名称",
      "minor": "小类名称",
      "confidence": 0.95
    }
  ]
}
\`\`\`

- index: 与输入序号对应
- confidence: 0-1 的置信度
- 不要有任何 JSON 之外的文字`;

// ==================== Token 估算与智能分批 ====================

/** 粗估一条文案的 token 数（中文字×1.5 + 英文词×1.3 + 输出开销） */
function estimateTokens(item: AiClassifyItem): number {
    const text = item.zhText || item.enText || item.text || '';
    // 中文字符数
    const zhChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    // 英文单词数
    const enWords = (text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, '').match(/[a-zA-Z]+/g) || []).length;
    // 输入 token + 输出 token（每条约 60 tokens 输出）
    return Math.ceil(zhChars * 1.5 + enWords * 1.3) + 60;
}

/** 
 * 按 token 预算智能分批
 * - MAX_BATCH_TOKENS: 每批最大输入+输出 token（留空间给 system prompt ~4000 tokens）
 * - maxCount: 每批最大条数上限（用户设置的 batchSize）
 */
function buildSmartBatches(items: AiClassifyItem[], maxCount: number): AiClassifyItem[][] {
    const MAX_BATCH_TOKENS = 28000; // 安全预算（65K输出 - 4K系统prompt - 余量）
    const batches: AiClassifyItem[][] = [];
    let currentBatch: AiClassifyItem[] = [];
    let currentTokens = 0;

    for (const item of items) {
        const tokenCost = estimateTokens(item);
        // 当前批次满了：达到 token 上限或条数上限
        if (currentBatch.length > 0 && (currentTokens + tokenCost > MAX_BATCH_TOKENS || currentBatch.length >= maxCount)) {
            batches.push(currentBatch);
            currentBatch = [];
            currentTokens = 0;
        }
        currentBatch.push(item);
        currentTokens += tokenCost;
    }
    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }
    return batches;
}

// ==================== 核心分类函数 ====================

/**
 * 使用 AI 对文案进行语义分类
 * 
 * 特性：
 * - 逐批流式返回: 每完成一批立即回调 onBatchDone
 * - 取消支持: 通过 AbortSignal 取消
 * - 失败重试: 每批自动重试 2 次 + API key 轮换
 * - 并发控制: 多个 batch 同时执行
 */
export async function classifyWithAI(
    items: AiClassifyItem[],
    options: {
        depth: 'full' | 'major' | 'custom';
        batchSize: number;
        concurrency?: number;
        customRules?: string;
        systemPromptOverride?: string;
        customLevels?: string[];
        model?: string;
        signal?: AbortSignal;
        onProgress?: (progress: AiClassifyProgress) => void;
        onBatchDone?: (results: AiClassifyResult[]) => void;  // 每批完成立即回调
    }
): Promise<AiClassifyResult[]> {
    const { depth, batchSize, customRules, systemPromptOverride, customLevels, onProgress, onBatchDone, signal } = options;
    const concurrency = options.concurrency ?? 3;
    const model = options.model ?? 'gemini-3-flash-preview';

    if (items.length === 0) return [];

    const allResults: AiClassifyResult[] = [];

    // 智能分批：按 token 预估分组，而非固定条数
    const batches = buildSmartBatches(items, batchSize);
    const totalBatches = batches.length;
    let completedBatches = 0;

    // 并发控制 worker
    const queue = [...batches.keys()]; // batch 索引队列
    const activeWorkers = new Set<Promise<void>>();

    const processBatch = async (batchIdx: number) => {
        if (signal?.aborted) return;

        const batchItems = batches[batchIdx];

        try {
            // 自动重试（最多 2 次）
            const batchResults = await retryClassifyBatch(batchItems, model, depth, customRules, systemPromptOverride, signal, customLevels);
            allResults.push(...batchResults);
            onBatchDone?.(batchResults);
        } catch (error: any) {
            if (signal?.aborted) return;
            console.error(`批次 ${batchIdx + 1} 分类失败:`, error);
            // 失败的批次标记为错误
            const failedResults = batchItems.map((item: AiClassifyItem) => ({
                ...item,
                major: '❌ 失败',
                middle: '分类失败',
                minor: error?.message?.substring(0, 80) || '未知错误',
                confidence: 0,
                isManual: false,
            }));
            allResults.push(...failedResults);
            onBatchDone?.(failedResults);
        }

        completedBatches++;
        onProgress?.({
            current: completedBatches,
            total: totalBatches,
            status: signal?.aborted
                ? `已停止 · ${completedBatches}/${totalBatches} 批`
                : `AI 分类中 (${completedBatches}/${totalBatches})…`
        });
    };

    // 并发执行
    while (queue.length > 0 || activeWorkers.size > 0) {
        if (signal?.aborted) break;

        while (queue.length > 0 && activeWorkers.size < concurrency) {
            if (signal?.aborted) break;
            const batchIdx = queue.shift()!;
            const promise = processBatch(batchIdx).finally(() => {
                activeWorkers.delete(promise);
            });
            activeWorkers.add(promise);
        }
        if (activeWorkers.size > 0) {
            await Promise.race(activeWorkers);
        }
    }

    onProgress?.({
        current: completedBatches,
        total: totalBatches,
        status: signal?.aborted
            ? `已停止 · 完成 ${completedBatches}/${totalBatches} 批 · ${allResults.length} 条`
            : `分类完成 · ${allResults.length}条 · ${totalBatches}批`
    });

    return allResults;
}

/**
 * 带重试的单批次分类
 */
async function retryClassifyBatch(
    items: AiClassifyItem[],
    model: string,
    depth: 'full' | 'major' | 'custom',
    customRules?: string,
    systemPromptOverride?: string,
    signal?: AbortSignal,
    customLevels?: string[],
    maxRetries = 2
): Promise<AiClassifyResult[]> {
    let lastError: Error | null = null;
    let didRotate = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal?.aborted) throw new Error('已取消');

        try {
            return await classifyBatch(items, model, depth, customRules, systemPromptOverride, customLevels);
        } catch (error: any) {
            lastError = error;
            const errMsg = (error?.message || '').toLowerCase();
            const isQuotaError = errMsg.includes('429') || errMsg.includes('rate') ||
                errMsg.includes('quota') || errMsg.includes('resource exhausted');

            if (isQuotaError && attempt < maxRetries) {
                // 尝试轮换 API key
                if (!didRotate && typeof window !== 'undefined' && (window as any).__app_rotate_api_key) {
                    (window as any).__app_rotate_api_key();
                    didRotate = true;
                    continue; // 轮换后立即重试
                }
                // 指数退避
                const delay = 2000 * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }
        }
    }
    throw lastError || new Error('分类失败');
}

/**
 * 处理单个批次
 */
async function classifyBatch(
    items: AiClassifyItem[],
    model: string,
    depth: 'full' | 'major' | 'custom',
    customRules?: string,
    systemPromptOverride?: string,
    customLevels?: string[]
): Promise<AiClassifyResult[]> {
    const ai = getAiInstance();

    // 构建用户提示
    const depthHint = depth === 'major'
        ? '\n\n注意：本次只需分到大类即可，中类和小类可以填空字符串。'
        : depth === 'custom'
        ? '\n\n注意：当前为"完全自定义"模式，请仔细阅读【用户提供的分类规则】，从中选出最匹配的大类、中类和小类。如果用户没有提供中类或小类的规则，对应的字段请直接留空。'
        : '';

    const userPrompt = `请对以下 ${items.length} 条文案进行分类。${depthHint}

文案列表：
${items.map(item => {
        const textDisplay = item.enText && item.zhText
            ? `[${item.index}] (中) ${item.zhText}\n    (EN) ${item.enText}`
            : `[${item.index}] ${item.text}`;
        return textDisplay;
    }).join('\n\n')}

请严格按照 JSON 格式返回结果（包含 results 数组），不要有任何其他内容。`;

    // 拼接自定义规则
    let systemPrompt = systemPromptOverride || CLASSIFY_SYSTEM_PROMPT;
    
    if (depth === 'custom') {
        const levelsJSON = customLevels && customLevels.length > 0
            ? customLevels.map(lvl => `      "${lvl}": "填入符合的名称，无则留空"`).join(',\n')
            : `      "分类名称": "填入符合的名称，无则留空"`;

        systemPrompt = `你是一名专业的文案分类专家。
任务：请完全根据下方【用户提供的分类类别/规则】，为用户的每一条文案挑选出最符合每个维度的标签。
规则说明：你可以完全无视传统的树状从属关系，只需判断文案内容符合哪些你手头的标签即可。如果用户提供了不同层级/维度的类别名称，请分别为每个维度分配一个标签。
如果对于某一个层级，用户并没有提供对应的类别/规则，或者没有合适匹配项，该字段请留空。

${customRules && customRules.trim() ? `## 用户分类规则与维度列表\n\n${customRules}` : '## 用户分类规则与维度列表\n\n（无）'}

返回格式：
请严格按照以下 JSON 输出格式。不可加入任何其他代码块、文本说明或注释。只输出 JSON 对象：
{
  "results": [
    {
      "index": 0, // 对应输入文案的 index
      "categories": {
${levelsJSON}
      }
    }
  ]
}`;
    } else {
        if (customRules && customRules.trim()) {
            systemPrompt += `\n\n## 五、用户自定义分类规则（优先级高于内置规则）\n\n以下是用户追加的自定义分类。如果文案符合这些规则，优先使用自定义分类。自定义分类可以是新的大类、中类或小类。\n\n${customRules.trim()}`;
        }
    }

    const result = await ai.models.generateContent({
        model,
        contents: { role: 'user', parts: [{ text: userPrompt }] },
        config: {
            systemInstruction: systemPrompt,
        }
    });

    const responseText = result.text?.trim() || '{}';

    // 解析 JSON
    let parsed: any;
    try {
        parsed = JSON.parse(responseText);
    } catch {
        // 尝试提取 JSON
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
        } else {
            throw new Error('无法解析 AI 返回的 JSON');
        }
    }

    const results: AiClassifyResult[] = [];
    const aiResults = parsed.results || [];

    // 映射回原始 items
    for (const item of items) {
        const aiResult = aiResults.find((r: any) => r.index === item.index);
        const isCustom = depth === 'custom';
        
        let customCategories: Record<string, string> = {};
        let major = '其他';
        let middle = '其他类';
        let minor = '';

        if (aiResult) {
            if (isCustom && aiResult.categories) {
                customCategories = typeof aiResult.categories === 'object' ? aiResult.categories : {};
                major = customCategories['大类'] || customCategories['major'] || '';
                middle = customCategories['中类'] || customCategories['middle'] || '';
                minor = customCategories['小类'] || customCategories['minor'] || '';
                if (customLevels && customLevels.length > 0) {
                    major = customCategories[customLevels[0]] || major || '';
                    middle = customLevels.length > 1 ? customCategories[customLevels[1]] || middle || '' : middle;
                    minor = customLevels.length > 2 ? customCategories[customLevels[2]] || minor || '' : minor;
                } else if (!major && Object.keys(customCategories).length > 0) {
                    const keys = Object.keys(customCategories);
                    major = customCategories[keys[0]] || major || '';
                    middle = keys.length > 1 ? customCategories[keys[1]] || middle || '' : middle;
                    minor = keys.length > 2 ? customCategories[keys[2]] || minor || '' : minor;
                }
            } else {
                major = aiResult.major || '其他';
                middle = aiResult.middle || '其他类';
                minor = aiResult.minor || '';
            }

            // 确保 customCategories 始终包含 major/middle/minor 映射
            // 这样复制函数无论用 customCategories 还是 major/middle/minor 都能拿到值
            if (!customCategories['大类'] && major) customCategories['大类'] = major;
            if (!customCategories['中类'] && middle) customCategories['中类'] = middle;
            if (!customCategories['小类'] && minor) customCategories['小类'] = minor;

            results.push({
                index: item.index,
                originalRowIndex: item.originalRowIndex,
                text: item.text,
                zhText: item.zhText,
                enText: item.enText,
                major,
                middle,
                minor,
                customCategories,
                confidence: Math.min(1, Math.max(0, aiResult.confidence || 0.5)),
                isManual: false,
            });
        } else {
            // AI 未返回该条的结果
            results.push({
                ...item,
                major: '其他',
                middle: '其他类',
                minor: '未匹配',
                customCategories: {},
                confidence: 0,
                isManual: false,
            });
        }
    }

    return results;
}

// ==================== 统计计算 ====================

export interface ClassifyStats {
    majorCounts: Record<string, number>;
    middleCounts: Record<string, number>;
    minorCounts: Record<string, number>;
}

export function computeClassifyStats(results: AiClassifyResult[]): ClassifyStats {
    const majorCounts: Record<string, number> = {};
    const middleCounts: Record<string, number> = {};
    const minorCounts: Record<string, number> = {};

    for (const r of results) {
        if (!r.text) continue; // skip empty rows
        majorCounts[r.major] = (majorCounts[r.major] || 0) + 1;
        if (r.middle) middleCounts[r.middle] = (middleCounts[r.middle] || 0) + 1;
        if (r.minor) minorCounts[r.minor] = (minorCounts[r.minor] || 0) + 1;
    }

    return { majorCounts, middleCounts, minorCounts };
}

/**
 * 按数量降序排序的 entries
 */
export function sortedEntries(counts: Record<string, number>): [string, number][] {
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
