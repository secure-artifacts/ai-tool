/**
 * 预翻译语料库 - 高频美术反馈问题的专业英文表述
 * 
 * 这些翻译已经过人工校对，适合跨文化专业沟通
 * 使用「建议式」语气，避免生硬或命令式表达
 */

export interface CannedPhrase {
    id: string;
    category: string;           // 分类
    labelCn: string;            // 中文标签
    labelEn: string;            // 英文标签
    problemCn: string;          // 问题描述（中文）
    problemEn: string;          // 问题描述（英文，已润色）
    suggestionCn: string;       // 建议（中文）
    suggestionEn: string;       // 建议（英文，已润色）
    icon: string;               // 图标
}

// 预设语料库分类
export const PHRASE_CATEGORIES = [
    { id: 'aspect', label: '尺寸比例', labelEn: 'Aspect Ratio' },
    { id: 'style', label: '风格真实度', labelEn: 'Style & Realism' },
    { id: 'framing', label: '镜头景别', labelEn: 'Framing' },
    { id: 'pose', label: '姿势动作', labelEn: 'Pose' },
    { id: 'expression', label: '表情神态', labelEn: 'Expression' },
    { id: 'wardrobe', label: '服装穿搭', labelEn: 'Wardrobe' },
    { id: 'character', label: '人物特征', labelEn: 'Character' },
    { id: 'background', label: '背景场景', labelEn: 'Background' },
    { id: 'lighting', label: '光线天气', labelEn: 'Lighting' },
    { id: 'anatomy', label: '人体结构', labelEn: 'Anatomy' },
    { id: 'texture', label: '贴图材质', labelEn: 'Texture' },
    { id: 'color', label: '颜色配色', labelEn: 'Color' },
    { id: 'technical', label: '技术问题', labelEn: 'Technical' },
];

// 预设语料库
export const CANNED_PHRASES: CannedPhrase[] = [
    // ========== 尺寸比例 ==========
    {
        id: 'aspect-916',
        category: 'aspect',
        labelCn: '尺寸比例不对 (需要9:16)',
        labelEn: 'Wrong Aspect Ratio (Need 9:16)',
        problemCn: '图片尺寸比例不对，我们需要使用9:16的画面尺寸。',
        problemEn: 'The current image aspect ratio doesn\'t quite match our requirements. We\'re looking for a 9:16 vertical format for this project.',
        suggestionCn: '请调整为9:16竖版尺寸',
        suggestionEn: 'Would it be possible to adjust the image to a 9:16 vertical aspect ratio? This format works best for our platform.',
        icon: '📐',
    },
    {
        id: 'aspect-169',
        category: 'aspect',
        labelCn: '尺寸比例不对 (需要16:9)',
        labelEn: 'Wrong Aspect Ratio (Need 16:9)',
        problemCn: '图片尺寸比例不对，我们需要使用16:9的画面尺寸。',
        problemEn: 'The current image aspect ratio doesn\'t quite match our requirements. We\'re looking for a 16:9 horizontal format for this project.',
        suggestionCn: '请调整为16:9横版尺寸',
        suggestionEn: 'Would it be possible to adjust the image to a 16:9 horizontal aspect ratio? This format works best for our platform.',
        icon: '📐',
    },
    {
        id: 'aspect-11',
        category: 'aspect',
        labelCn: '尺寸比例不对 (需要1:1)',
        labelEn: 'Wrong Aspect Ratio (Need 1:1)',
        problemCn: '图片尺寸比例不对，我们需要使用1:1的正方形尺寸。',
        problemEn: 'The current image aspect ratio doesn\'t quite match our requirements. We\'re looking for a 1:1 square format for this project.',
        suggestionCn: '请调整为1:1正方形尺寸',
        suggestionEn: 'Would it be possible to adjust the image to a 1:1 square aspect ratio? This format works best for our platform.',
        icon: '📐',
    },

    // ========== 风格真实度 ==========
    {
        id: 'style-realism',
        category: 'style',
        labelCn: '风格真实度不够',
        labelEn: 'Realism Level Not Ideal',
        problemCn: '图片的风格真实度目前不符合我们常用且比较容易爆贴的风格类型。',
        problemEn: 'The current visual style doesn\'t quite match our preferred aesthetic. We typically find that a more photorealistic look performs better with our audience.',
        suggestionCn: '建议使用更真实的风格，可以尝试使用 Gemini Pro 的 nanobanana pro 模型进行生成',
        suggestionEn: 'Could you perhaps try regenerating with a more photorealistic style? We\'ve found that the Gemini Pro nanobanana pro model tends to produce results that resonate well with our target audience.',
        icon: '🎨',
    },
    {
        id: 'style-too-ai',
        category: 'style',
        labelCn: 'AI感太强',
        labelEn: 'Too AI-Generated Looking',
        problemCn: '图片看起来AI生成感太强，不够自然真实。',
        problemEn: 'The image currently has a noticeable AI-generated quality that may not connect as well with our audience.',
        suggestionCn: '建议调整到更自然、更像真实照片的风格',
        suggestionEn: 'Would it be possible to aim for a more natural, photograph-like appearance? We find that images with a more authentic feel tend to perform better.',
        icon: '🤖',
    },

    // ========== 镜头景别 ==========
    {
        id: 'framing-too-far',
        category: 'framing',
        labelCn: '人物距离镜头太远',
        labelEn: 'Subject Too Far From Camera',
        problemCn: '图片人物距离镜头太远了。',
        problemEn: 'The subject appears to be positioned quite far from the camera in this composition.',
        suggestionCn: '可以近一些，类似参考图这种镜头景别。',
        suggestionEn: 'Could we perhaps bring the camera closer to the subject? Something similar to the reference image framing would work wonderfully.',
        icon: '📷',
    },
    {
        id: 'framing-too-close',
        category: 'framing',
        labelCn: '人物距离镜头太近',
        labelEn: 'Subject Too Close To Camera',
        problemCn: '图片人物距离镜头太近了，有些压迫感。',
        problemEn: 'The subject seems to be positioned very close to the camera, which creates a somewhat cramped feeling.',
        suggestionCn: '建议稍微拉远一些，留出更多空间',
        suggestionEn: 'Would it be possible to pull back the camera a bit? A little more breathing room around the subject would enhance the overall composition.',
        icon: '📷',
    },
    {
        id: 'framing-headroom',
        category: 'framing',
        labelCn: '头部空间不足',
        labelEn: 'Insufficient Headroom',
        problemCn: '人物头顶空间太少，显得很局促。',
        problemEn: 'There doesn\'t seem to be quite enough space above the subject\'s head in the current framing.',
        suggestionCn: '建议在头顶预留适当空间',
        suggestionEn: 'Could you perhaps adjust the framing to include a bit more headroom? This would make the composition feel more balanced.',
        icon: '📷',
    },

    // ========== 姿势动作 ==========
    {
        id: 'pose-unnatural',
        category: 'pose',
        labelCn: '姿势不自然',
        labelEn: 'Unnatural Pose',
        problemCn: '图片中人物姿势不是很自然。',
        problemEn: 'The subject\'s pose appears a bit stiff or unnatural in the current image.',
        suggestionCn: '可以调整自然一些，更放松的状态。',
        suggestionEn: 'Would it be possible to adjust the pose to feel more relaxed and natural? A more casual, comfortable posture would really enhance the authenticity.',
        icon: '🧍',
    },
    {
        id: 'pose-awkward-hands',
        category: 'pose',
        labelCn: '手部姿势不自然',
        labelEn: 'Awkward Hand Position',
        problemCn: '人物的手部姿势看起来有些怪异。',
        problemEn: 'The hand positioning looks a bit awkward in the current pose.',
        suggestionCn: '建议调整手部位置，可以自然下垂或有所依靠',
        suggestionEn: 'Could the hands be repositioned to look more natural? Perhaps resting at the sides or with a subtle gesture would work better.',
        icon: '🤚',
    },

    // ========== 人物角度 ==========
    {
        id: 'angle-not-facing',
        category: 'pose',
        labelCn: '人物没有正对镜头',
        labelEn: 'Subject Not Facing Camera',
        problemCn: '图片中人物角度有一些问题，需要正对着镜头，人物看着镜头。',
        problemEn: 'The subject\'s angle could use some adjustment - they\'re not quite facing the camera directly.',
        suggestionCn: '请让人物正对镜头，眼神看向镜头',
        suggestionEn: 'Would it be possible to have the subject face the camera directly? Eye contact with the viewer really helps create a stronger connection.',
        icon: '👀',
    },
    {
        id: 'angle-side-profile',
        category: 'pose',
        labelCn: '侧脸角度太多',
        labelEn: 'Too Much Side Profile',
        problemCn: '人物侧脸角度太多，面部不够正。',
        problemEn: 'The subject is showing quite a bit of their profile, with their face turned away from the camera.',
        suggestionCn: '建议调整为更正面的角度',
        suggestionEn: 'Could we adjust the angle to show more of the subject\'s face? A more frontal view would work better for our needs.',
        icon: '👤',
    },

    // ========== 表情神态 ==========
    {
        id: 'expression-bland',
        category: 'expression',
        labelCn: '表情平淡缺乏亲和力',
        labelEn: 'Expression Lacks Warmth',
        problemCn: '图片中人物表情不是太好，比较平淡，缺乏亲和力。',
        problemEn: 'The subject\'s expression appears a bit flat and could use more warmth to connect with viewers.',
        suggestionCn: '可以稍微带一点点的微笑，自然一些。',
        suggestionEn: 'Would it be possible to capture a more approachable expression? A gentle, natural smile would really help connect with our audience.',
        icon: '😊',
    },
    {
        id: 'expression-too-serious',
        category: 'expression',
        labelCn: '表情太严肃',
        labelEn: 'Expression Too Serious',
        problemCn: '人物表情太严肃了，给人距离感。',
        problemEn: 'The subject\'s expression comes across as quite serious, which may create some distance with viewers.',
        suggestionCn: '建议表情更轻松友好一些',
        suggestionEn: 'Could we aim for a friendlier, more relaxed expression? This would help create a warmer connection with the audience.',
        icon: '😐',
    },
    {
        id: 'expression-forced',
        category: 'expression',
        labelCn: '表情不太自然',
        labelEn: 'Expression Seems Forced',
        problemCn: '人物表情看起来有些刻意，不够自然。',
        problemEn: 'The expression appears a bit posed or forced rather than natural.',
        suggestionCn: '建议捕捉更自然放松的表情',
        suggestionEn: 'Would it be possible to capture a more candid, relaxed expression? Natural expressions tend to resonate better with viewers.',
        icon: '😬',
    },

    // ========== 服装穿搭 ==========
    {
        id: 'wardrobe-inappropriate',
        category: 'wardrobe',
        labelCn: '服装不太合适',
        labelEn: 'Wardrobe Not Ideal',
        problemCn: '图片中人物服装稍微有点不合适。',
        problemEn: 'The current wardrobe choice might not be the best fit for our content requirements.',
        suggestionCn: '可以选择大方得体端庄不暴露的衣服，领口不要太低的衣服。',
        suggestionEn: 'Could we perhaps go with more modest, professional attire? We\'re looking for elegant, appropriate clothing with a conservative neckline that would appeal to our audience.',
        icon: '👔',
    },
    {
        id: 'wardrobe-too-casual',
        category: 'wardrobe',
        labelCn: '服装太随意',
        labelEn: 'Wardrobe Too Casual',
        problemCn: '人物穿着太随意，不够正式。',
        problemEn: 'The current outfit appears a bit too casual for our intended purpose.',
        suggestionCn: '建议选择更正式或商务休闲的着装',
        suggestionEn: 'Would it be possible to choose something a bit more polished? A smart casual or business casual look would work wonderfully.',
        icon: '👕',
    },
    {
        id: 'wardrobe-color-clash',
        category: 'wardrobe',
        labelCn: '服装颜色不协调',
        labelEn: 'Wardrobe Color Mismatch',
        problemCn: '服装颜色和整体画面不太协调。',
        problemEn: 'The clothing colors don\'t quite harmonize with the overall color palette of the scene.',
        suggestionCn: '建议选择与背景或主题更协调的服装颜色',
        suggestionEn: 'Could we perhaps adjust the clothing color to better complement the scene? A more harmonious color choice would enhance the overall look.',
        icon: '🎨',
    },

    // ========== 人物特征 ==========
    {
        id: 'character-too-young',
        category: 'character',
        labelCn: '人物年龄太年轻',
        labelEn: 'Subject Appears Too Young',
        problemCn: '图片中人物年龄太年轻了。',
        problemEn: 'The subject appears younger than what we\'re looking for in this project.',
        suggestionCn: '建议使用40-50左右的年龄',
        suggestionEn: 'Would it be possible to feature a subject who appears to be around 40-50 years old? This age range tends to connect better with our target demographic.',
        icon: '👤',
    },
    {
        id: 'character-too-old',
        category: 'character',
        labelCn: '人物年龄偏大',
        labelEn: 'Subject Appears Too Old',
        problemCn: '图片中人物年龄看起来偏大了一些。',
        problemEn: 'The subject appears a bit older than what we had in mind for this project.',
        suggestionCn: '建议使用年轻一些的形象',
        suggestionEn: 'Could we perhaps feature a slightly younger-looking subject? This would better match our target audience expectations.',
        icon: '👤',
    },
    {
        id: 'character-hairstyle',
        category: 'character',
        labelCn: '发型太随意',
        labelEn: 'Hairstyle Too Casual',
        problemCn: '图片中人物发型不要太过于随意。',
        problemEn: 'The subject\'s hairstyle appears somewhat casual or unkempt for our content needs.',
        suggestionCn: '建议选择更整洁得体的发型',
        suggestionEn: 'Would it be possible to feature a neater, more polished hairstyle? A well-groomed look would really enhance the professional feel.',
        icon: '💇',
    },

    // ========== 背景场景 ==========
    {
        id: 'background-blurry',
        category: 'background',
        labelCn: '背景太模糊',
        labelEn: 'Background Too Blurry',
        problemCn: '图片中场景、背景有些模糊，我们比较喜欢背景清晰，不模糊，无景深，更像是手机直接拍摄的样子。',
        problemEn: 'The background appears quite blurred with heavy depth of field effects. We prefer a sharper, more in-focus background.',
        suggestionCn: '请保持背景清晰，减少景深效果，类似手机拍摄的效果',
        suggestionEn: 'Could we minimize the depth of field effect and keep the background in focus? We\'re aiming for that authentic smartphone photo look where everything is relatively sharp.',
        icon: '🖼️',
    },
    {
        id: 'background-messy',
        category: 'background',
        labelCn: '场景太杂乱',
        labelEn: 'Background Too Cluttered',
        problemCn: '图片中场景不要太随意，太杂乱。',
        problemEn: 'The background scene appears a bit cluttered or disorganized, which can be distracting.',
        suggestionCn: '建议使用更整洁、简单的背景',
        suggestionEn: 'Would it be possible to use a cleaner, simpler background? A tidier setting would help keep the focus on the subject.',
        icon: '🧹',
    },
    {
        id: 'background-distracting',
        category: 'background',
        labelCn: '背景元素干扰主体',
        labelEn: 'Distracting Background Elements',
        problemCn: '背景中有些元素分散了对主体的注意力。',
        problemEn: 'Some elements in the background seem to draw attention away from the main subject.',
        suggestionCn: '建议移除或弱化干扰元素',
        suggestionEn: 'Could we perhaps remove or tone down those distracting elements in the background? This would help keep the viewer\'s focus on the subject.',
        icon: '🎯',
    },

    // ========== 光线天气 ==========
    {
        id: 'lighting-weather',
        category: 'lighting',
        labelCn: '天气建议改为晴天',
        labelEn: 'Suggest Sunny Weather',
        problemCn: '图片的天气不太理想。',
        problemEn: 'The weather conditions in the image could be more appealing.',
        suggestionCn: '建议使用晴天、白天的场景',
        suggestionEn: 'Would it be possible to set the scene during a bright, sunny day? Clear daytime lighting tends to create more inviting and positive imagery.',
        icon: '☀️',
    },
    {
        id: 'lighting-too-dark',
        category: 'lighting',
        labelCn: '光线太暗',
        labelEn: 'Lighting Too Dark',
        problemCn: '整体画面光线太暗了。',
        problemEn: 'The overall lighting in the image appears quite dark.',
        suggestionCn: '建议增加光线亮度，让画面更明亮',
        suggestionEn: 'Could we perhaps brighten up the lighting? A brighter, more well-lit scene would really enhance the overall appeal.',
        icon: '💡',
    },
    {
        id: 'lighting-harsh',
        category: 'lighting',
        labelCn: '光线过硬',
        labelEn: 'Harsh Lighting',
        problemCn: '光线太硬了，阴影很明显。',
        problemEn: 'The lighting appears quite harsh, creating strong shadows.',
        suggestionCn: '建议使用更柔和的光线',
        suggestionEn: 'Would it be possible to soften the lighting? Gentler, more diffused light would create a more flattering look.',
        icon: '🌤️',
    },

    // ========== 人体结构 ==========
    {
        id: 'anatomy-fingers',
        category: 'anatomy',
        labelCn: '手指数量错误',
        labelEn: 'Incorrect Finger Count',
        problemCn: '手指数量不对，看起来多了或少了。',
        problemEn: 'The finger count appears to be off - there seem to be too many or too few digits.',
        suggestionCn: '请确保手部有正确的五根手指',
        suggestionEn: 'Could you please ensure the hand has the correct five fingers? This is an important detail for realism.',
        icon: '🖐️',
    },
    {
        id: 'anatomy-proportion',
        category: 'anatomy',
        labelCn: '人体比例失调',
        labelEn: 'Body Proportion Issues',
        problemCn: '人体比例看起来不太协调。',
        problemEn: 'The body proportions appear somewhat unnatural in certain areas.',
        suggestionCn: '建议调整到更自然的人体比例',
        suggestionEn: 'Would it be possible to adjust the proportions to look more natural? Realistic body proportions would greatly enhance the image.',
        icon: '📏',
    },
    {
        id: 'anatomy-face',
        category: 'anatomy',
        labelCn: '面部不自然',
        labelEn: 'Unnatural Facial Features',
        problemCn: '面部五官看起来有些不协调或不自然。',
        problemEn: 'Some facial features appear a bit unnatural or disproportionate.',
        suggestionCn: '建议调整面部特征使其更加协调自然',
        suggestionEn: 'Could the facial features be adjusted to look more natural and harmonious? This would really improve the overall authenticity.',
        icon: '👤',
    },

    // ========== 贴图材质 ==========
    {
        id: 'texture-blurry',
        category: 'texture',
        labelCn: '贴图模糊',
        labelEn: 'Blurry Texture',
        problemCn: '材质贴图不够清晰，细节丢失。',
        problemEn: 'The texture quality appears to have lost some detail and sharpness.',
        suggestionCn: '请使用更高分辨率的贴图',
        suggestionEn: 'Would it be possible to use a higher resolution texture? Sharper details would really enhance the quality.',
        icon: '🔍',
    },
    {
        id: 'texture-skin',
        category: 'texture',
        labelCn: '皮肤质感不真实',
        labelEn: 'Unrealistic Skin Texture',
        problemCn: '皮肤质感看起来不够真实，可能太光滑或太粗糙。',
        problemEn: 'The skin texture doesn\'t quite look natural - it may appear too smooth or too rough.',
        suggestionCn: '建议调整皮肤材质使其更真实',
        suggestionEn: 'Could the skin texture be adjusted to look more realistic? A more natural skin appearance would enhance the authenticity.',
        icon: '✨',
    },

    // ========== 颜色配色 ==========
    {
        id: 'color-saturation',
        category: 'color',
        labelCn: '颜色过于鲜艳',
        labelEn: 'Over-Saturated Colors',
        problemCn: '整体颜色饱和度太高，看起来不够自然。',
        problemEn: 'The color saturation appears quite high, making the image look less natural.',
        suggestionCn: '建议降低饱和度，使用更自然的色彩',
        suggestionEn: 'Could we perhaps tone down the saturation a bit? More natural colors would create a more authentic feel.',
        icon: '🌈',
    },
    {
        id: 'color-warmth',
        category: 'color',
        labelCn: '色调太冷/太暖',
        labelEn: 'Color Temperature Off',
        problemCn: '图片整体色调不太理想。',
        problemEn: 'The overall color temperature of the image could be adjusted.',
        suggestionCn: '建议调整到更合适的色温',
        suggestionEn: 'Would it be possible to adjust the color temperature? A warmer/cooler tone might work better for this scene.',
        icon: '🎨',
    },

    // ========== 技术问题 ==========
    {
        id: 'technical-resolution',
        category: 'technical',
        labelCn: '分辨率不足',
        labelEn: 'Low Resolution',
        problemCn: '图片分辨率不够高，放大后模糊。',
        problemEn: 'The image resolution appears to be lower than what we need for this project.',
        suggestionCn: '请提供更高分辨率的版本',
        suggestionEn: 'Would it be possible to provide a higher resolution version? We need crisp, clear imagery for our platform.',
        icon: '📺',
    },
    {
        id: 'technical-artifacts',
        category: 'technical',
        labelCn: '有压缩或生成伪影',
        labelEn: 'Compression/Generation Artifacts',
        problemCn: '图片中有明显的压缩痕迹或AI生成的伪影。',
        problemEn: 'There appear to be some visible compression artifacts or AI generation artifacts in the image.',
        suggestionCn: '建议重新生成或导出无损版本',
        suggestionEn: 'Could you perhaps regenerate or export a cleaner version? Removing these artifacts would really improve the quality.',
        icon: '🔧',
    },
    {
        id: 'technical-watermark',
        category: 'technical',
        labelCn: '有水印或标记',
        labelEn: 'Visible Watermark',
        problemCn: '图片中有水印或不需要的标记。',
        problemEn: 'There appears to be a watermark or unwanted marking visible in the image.',
        suggestionCn: '请提供无水印的版本',
        suggestionEn: 'Would it be possible to provide a version without the watermark? We need clean imagery for final use.',
        icon: '©️',
    },
];

/**
 * 按分类获取语料
 */
export function getPhrasesByCategory(category: string): CannedPhrase[] {
    return CANNED_PHRASES.filter(p => p.category === category);
}

/**
 * 搜索语料（支持中英文关键词）
 */
export function searchPhrases(query: string): CannedPhrase[] {
    const lower = query.toLowerCase();
    return CANNED_PHRASES.filter(p =>
        p.labelCn.includes(query) ||
        p.labelEn.toLowerCase().includes(lower) ||
        p.problemCn.includes(query) ||
        p.suggestionCn.includes(query)
    );
}

/**
 * 获取所有语料
 */
export function getAllPhrases(): CannedPhrase[] {
    return CANNED_PHRASES;
}
