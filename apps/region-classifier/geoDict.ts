// 地区分类引擎 - 纯前端字典匹配，支持 10 万+ 地址秒级分类

export interface GeoResult {
    original: string;
    country: string;
    countryCode: string;
    continent: string;
    confidence: 'high' | 'medium' | 'low' | 'unknown' | 'ai';
}

// 洲
const CONTINENTS: Record<string, string> = {
    AF: '非洲',
    AN: '南极洲',
    AS: '亚洲',
    EU: '欧洲',
    NA: '北美洲',
    OC: '大洋洲',
    SA: '南美洲',
};

// 国家代码 → [中文名, 英文名, 洲代码]
const COUNTRIES: Record<string, [string, string, string]> = {
    US: ['美国', 'United States', 'NA'],
    CN: ['中国', 'China', 'AS'],
    JP: ['日本', 'Japan', 'AS'],
    KR: ['韩国', 'South Korea', 'AS'],
    GB: ['英国', 'United Kingdom', 'EU'],
    DE: ['德国', 'Germany', 'EU'],
    FR: ['法国', 'France', 'EU'],
    IT: ['意大利', 'Italy', 'EU'],
    ES: ['西班牙', 'Spain', 'EU'],
    PT: ['葡萄牙', 'Portugal', 'EU'],
    NL: ['荷兰', 'Netherlands', 'EU'],
    BE: ['比利时', 'Belgium', 'EU'],
    SE: ['瑞典', 'Sweden', 'EU'],
    NO: ['挪威', 'Norway', 'EU'],
    DK: ['丹麦', 'Denmark', 'EU'],
    FI: ['芬兰', 'Finland', 'EU'],
    CH: ['瑞士', 'Switzerland', 'EU'],
    AT: ['奥地利', 'Austria', 'EU'],
    IE: ['爱尔兰', 'Ireland', 'EU'],
    PL: ['波兰', 'Poland', 'EU'],
    CZ: ['捷克', 'Czech Republic', 'EU'],
    RO: ['罗马尼亚', 'Romania', 'EU'],
    HU: ['匈牙利', 'Hungary', 'EU'],
    GR: ['希腊', 'Greece', 'EU'],
    HR: ['克罗地亚', 'Croatia', 'EU'],
    BG: ['保加利亚', 'Bulgaria', 'EU'],
    SK: ['斯洛伐克', 'Slovakia', 'EU'],
    SI: ['斯洛文尼亚', 'Slovenia', 'EU'],
    LT: ['立陶宛', 'Lithuania', 'EU'],
    LV: ['拉脱维亚', 'Latvia', 'EU'],
    EE: ['爱沙尼亚', 'Estonia', 'EU'],
    LU: ['卢森堡', 'Luxembourg', 'EU'],
    MT: ['马耳他', 'Malta', 'EU'],
    CY: ['塞浦路斯', 'Cyprus', 'EU'],
    IS: ['冰岛', 'Iceland', 'EU'],
    RU: ['俄罗斯', 'Russia', 'EU'],
    UA: ['乌克兰', 'Ukraine', 'EU'],
    BY: ['白俄罗斯', 'Belarus', 'EU'],
    RS: ['塞尔维亚', 'Serbia', 'EU'],
    BA: ['波黑', 'Bosnia and Herzegovina', 'EU'],
    ME: ['黑山', 'Montenegro', 'EU'],
    MK: ['北马其顿', 'North Macedonia', 'EU'],
    AL: ['阿尔巴尼亚', 'Albania', 'EU'],
    MD: ['摩尔多瓦', 'Moldova', 'EU'],
    CA: ['加拿大', 'Canada', 'NA'],
    MX: ['墨西哥', 'Mexico', 'NA'],
    BR: ['巴西', 'Brazil', 'SA'],
    AR: ['阿根廷', 'Argentina', 'SA'],
    CL: ['智利', 'Chile', 'SA'],
    CO: ['哥伦比亚', 'Colombia', 'SA'],
    PE: ['秘鲁', 'Peru', 'SA'],
    VE: ['委内瑞拉', 'Venezuela', 'SA'],
    EC: ['厄瓜多尔', 'Ecuador', 'SA'],
    UY: ['乌拉圭', 'Uruguay', 'SA'],
    PY: ['巴拉圭', 'Paraguay', 'SA'],
    BO: ['玻利维亚', 'Bolivia', 'SA'],
    AU: ['澳大利亚', 'Australia', 'OC'],
    NZ: ['新西兰', 'New Zealand', 'OC'],
    IN: ['印度', 'India', 'AS'],
    ID: ['印度尼西亚', 'Indonesia', 'AS'],
    TH: ['泰国', 'Thailand', 'AS'],
    VN: ['越南', 'Vietnam', 'AS'],
    PH: ['菲律宾', 'Philippines', 'AS'],
    MY: ['马来西亚', 'Malaysia', 'AS'],
    SG: ['新加坡', 'Singapore', 'AS'],
    MM: ['缅甸', 'Myanmar', 'AS'],
    KH: ['柬埔寨', 'Cambodia', 'AS'],
    LA: ['老挝', 'Laos', 'AS'],
    BD: ['孟加拉国', 'Bangladesh', 'AS'],
    LK: ['斯里兰卡', 'Sri Lanka', 'AS'],
    NP: ['尼泊尔', 'Nepal', 'AS'],
    PK: ['巴基斯坦', 'Pakistan', 'AS'],
    AF: ['阿富汗', 'Afghanistan', 'AS'],
    IR: ['伊朗', 'Iran', 'AS'],
    IQ: ['伊拉克', 'Iraq', 'AS'],
    SA: ['沙特阿拉伯', 'Saudi Arabia', 'AS'],
    AE: ['阿联酋', 'UAE', 'AS'],
    IL: ['以色列', 'Israel', 'AS'],
    TR: ['土耳其', 'Turkey', 'AS'],
    QA: ['卡塔尔', 'Qatar', 'AS'],
    KW: ['科威特', 'Kuwait', 'AS'],
    OM: ['阿曼', 'Oman', 'AS'],
    BH: ['巴林', 'Bahrain', 'AS'],
    JO: ['约旦', 'Jordan', 'AS'],
    LB: ['黎巴嫩', 'Lebanon', 'AS'],
    SY: ['叙利亚', 'Syria', 'AS'],
    YE: ['也门', 'Yemen', 'AS'],
    TW: ['台湾', 'Taiwan', 'AS'],
    HK: ['香港', 'Hong Kong', 'AS'],
    MO: ['澳门', 'Macau', 'AS'],
    MN: ['蒙古', 'Mongolia', 'AS'],
    KZ: ['哈萨克斯坦', 'Kazakhstan', 'AS'],
    UZ: ['乌兹别克斯坦', 'Uzbekistan', 'AS'],
    TM: ['土库曼斯坦', 'Turkmenistan', 'AS'],
    KG: ['吉尔吉斯斯坦', 'Kyrgyzstan', 'AS'],
    TJ: ['塔吉克斯坦', 'Tajikistan', 'AS'],
    GE: ['格鲁吉亚', 'Georgia', 'AS'],
    AM: ['亚美尼亚', 'Armenia', 'AS'],
    AZ: ['阿塞拜疆', 'Azerbaijan', 'AS'],
    EG: ['埃及', 'Egypt', 'AF'],
    ZA: ['南非', 'South Africa', 'AF'],
    NG: ['尼日利亚', 'Nigeria', 'AF'],
    KE: ['肯尼亚', 'Kenya', 'AF'],
    GH: ['加纳', 'Ghana', 'AF'],
    ET: ['埃塞俄比亚', 'Ethiopia', 'AF'],
    TZ: ['坦桑尼亚', 'Tanzania', 'AF'],
    MA: ['摩洛哥', 'Morocco', 'AF'],
    TN: ['突尼斯', 'Tunisia', 'AF'],
    DZ: ['阿尔及利亚', 'Algeria', 'AF'],
    LY: ['利比亚', 'Libya', 'AF'],
    CI: ['科特迪瓦', 'Ivory Coast', 'AF'],
    SN: ['塞内加尔', 'Senegal', 'AF'],
    CM: ['喀麦隆', 'Cameroon', 'AF'],
    UG: ['乌干达', 'Uganda', 'AF'],
    AO: ['安哥拉', 'Angola', 'AF'],
    MZ: ['莫桑比克', 'Mozambique', 'AF'],
    ZW: ['津巴布韦', 'Zimbabwe', 'AF'],
    RW: ['卢旺达', 'Rwanda', 'AF'],
    SD: ['苏丹', 'Sudan', 'AF'],
    CD: ['刚果(金)', 'DR Congo', 'AF'],
    CG: ['刚果(布)', 'Congo', 'AF'],
    CU: ['古巴', 'Cuba', 'NA'],
    JM: ['牙买加', 'Jamaica', 'NA'],
    HT: ['海地', 'Haiti', 'NA'],
    DO: ['多米尼加', 'Dominican Republic', 'NA'],
    PR: ['波多黎各', 'Puerto Rico', 'NA'],
    TT: ['特立尼达和多巴哥', 'Trinidad and Tobago', 'NA'],
    PA: ['巴拿马', 'Panama', 'NA'],
    CR: ['哥斯达黎加', 'Costa Rica', 'NA'],
    GT: ['危地马拉', 'Guatemala', 'NA'],
    HN: ['洪都拉斯', 'Honduras', 'NA'],
    SV: ['萨尔瓦多', 'El Salvador', 'NA'],
    NI: ['尼加拉瓜', 'Nicaragua', 'NA'],
    BZ: ['伯利兹', 'Belize', 'NA'],
    FJ: ['斐济', 'Fiji', 'OC'],
    PG: ['巴布亚新几内亚', 'Papua New Guinea', 'OC'],
    WS: ['萨摩亚', 'Samoa', 'OC'],
    GU: ['关岛', 'Guam', 'OC'],
    // === 补全缺失国家/地区 ===
    // 欧洲微型国+补充
    XK: ['科索沃', 'Kosovo', 'EU'],
    AD: ['安道尔', 'Andorra', 'EU'],
    MC: ['摩纳哥', 'Monaco', 'EU'],
    SM: ['圣马力诺', 'San Marino', 'EU'],
    VA: ['梵蒂冈', 'Vatican City', 'EU'],
    LI: ['列支敦士登', 'Liechtenstein', 'EU'],
    // 非洲补充
    SS: ['南苏丹', 'South Sudan', 'AF'],
    ER: ['厄立特里亚', 'Eritrea', 'AF'],
    DJ: ['吉布提', 'Djibouti', 'AF'],
    SO: ['索马里', 'Somalia', 'AF'],
    MG: ['马达加斯加', 'Madagascar', 'AF'],
    MU: ['毛里求斯', 'Mauritius', 'AF'],
    SC: ['塞舌尔', 'Seychelles', 'AF'],
    CV: ['佛得角', 'Cape Verde', 'AF'],
    ST: ['圣多美和普林西比', 'São Tomé and Príncipe', 'AF'],
    GQ: ['赤道几内亚', 'Equatorial Guinea', 'AF'],
    GA: ['加蓬', 'Gabon', 'AF'],
    TD: ['乍得', 'Chad', 'AF'],
    NE: ['尼日尔', 'Niger', 'AF'],
    ML: ['马里', 'Mali', 'AF'],
    BF: ['布基纳法索', 'Burkina Faso', 'AF'],
    BJ: ['贝宁', 'Benin', 'AF'],
    TG: ['多哥', 'Togo', 'AF'],
    SL: ['塞拉利昂', 'Sierra Leone', 'AF'],
    LR: ['利比里亚', 'Liberia', 'AF'],
    GN: ['几内亚', 'Guinea', 'AF'],
    GW: ['几内亚比绍', 'Guinea-Bissau', 'AF'],
    GM: ['冈比亚', 'Gambia', 'AF'],
    MR: ['毛里塔尼亚', 'Mauritania', 'AF'],
    MW: ['马拉维', 'Malawi', 'AF'],
    ZM: ['赞比亚', 'Zambia', 'AF'],
    BW: ['博茨瓦纳', 'Botswana', 'AF'],
    SZ: ['斯威士兰', 'Eswatini', 'AF'],
    LS: ['莱索托', 'Lesotho', 'AF'],
    KM: ['科摩罗', 'Comoros', 'AF'],
    BI: ['布隆迪', 'Burundi', 'AF'],
    CF: ['中非', 'Central African Republic', 'AF'],
    // 亚洲补充
    BN: ['文莱', 'Brunei', 'AS'],
    TL: ['东帝汶', 'Timor-Leste', 'AS'],
    MV: ['马尔代夫', 'Maldives', 'AS'],
    BT: ['不丹', 'Bhutan', 'AS'],
    KP: ['朝鲜', 'North Korea', 'AS'],
    PS: ['巴勒斯坦', 'Palestine', 'AS'],
    // 大洋洲补充
    TO: ['汤加', 'Tonga', 'OC'],
    VU: ['瓦努阿图', 'Vanuatu', 'OC'],
    SB: ['所罗门群岛', 'Solomon Islands', 'OC'],
    KI: ['基里巴斯', 'Kiribati', 'OC'],
    FM: ['密克罗尼西亚', 'Micronesia', 'OC'],
    MH: ['马绍尔群岛', 'Marshall Islands', 'OC'],
    PW: ['帕劳', 'Palau', 'OC'],
    NR: ['瑙鲁', 'Nauru', 'OC'],
    TV: ['图瓦卢', 'Tuvalu', 'OC'],
    NC: ['新喀里多尼亚', 'New Caledonia', 'OC'],
    PF: ['法属波利尼西亚', 'French Polynesia', 'OC'],
    CK: ['库克群岛', 'Cook Islands', 'OC'],
    // 加勒比/中美洲补充
    BS: ['巴哈马', 'Bahamas', 'NA'],
    BB: ['巴巴多斯', 'Barbados', 'NA'],
    AG: ['安提瓜和巴布达', 'Antigua and Barbuda', 'NA'],
    GD: ['格林纳达', 'Grenada', 'NA'],
    KN: ['圣基茨和尼维斯', 'Saint Kitts and Nevis', 'NA'],
    LC: ['圣卢西亚', 'Saint Lucia', 'NA'],
    VC: ['圣文森特', 'Saint Vincent', 'NA'],
    AW: ['阿鲁巴', 'Aruba', 'NA'],
    CW: ['库拉索', 'Curaçao', 'NA'],
    KY: ['开曼群岛', 'Cayman Islands', 'NA'],
    BM: ['百慕大', 'Bermuda', 'NA'],
    // 南美洲补充
    GY: ['圭亚那', 'Guyana', 'SA'],
    SR: ['苏里南', 'Suriname', 'SA'],
};

// 城市/地区 → 国家代码  (主要城市)
const CITY_TO_COUNTRY: Record<string, string> = {
    // 美国主要城市
    'new york': 'US', 'los angeles': 'US', 'chicago': 'US', 'houston': 'US', 'phoenix': 'US',
    'philadelphia': 'US', 'san antonio': 'US', 'san diego': 'US', 'dallas': 'US', 'san jose': 'US',
    'austin': 'US', 'jacksonville': 'US', 'san francisco': 'US', 'columbus': 'US', 'charlotte': 'US',
    'indianapolis': 'US', 'seattle': 'US', 'denver': 'US', 'washington': 'US', 'boston': 'US',
    'nashville': 'US', 'detroit': 'US', 'portland': 'US', 'las vegas': 'US', 'memphis': 'US',
    'louisville': 'US', 'baltimore': 'US', 'milwaukee': 'US', 'albuquerque': 'US', 'tucson': 'US',
    'fresno': 'US', 'sacramento': 'US', 'mesa': 'US', 'atlanta': 'US', 'omaha': 'US',
    'raleigh': 'US', 'miami': 'US', 'cleveland': 'US', 'tampa': 'US', 'oakland': 'US',
    'minneapolis': 'US', 'pittsburgh': 'US', 'st louis': 'US', 'honolulu': 'US',
    'manhattan': 'US', 'brooklyn': 'US', 'queens': 'US', 'bronx': 'US', 'staten island': 'US',
    'silicon valley': 'US', 'hollywood': 'US', 'beverly hills': 'US', 'santa monica': 'US',
    'palo alto': 'US', 'cupertino': 'US', 'mountain view': 'US', 'menlo park': 'US',
    'irvine': 'US', 'pasadena': 'US', 'long beach': 'US', 'anaheim': 'US',
    'orlando': 'US', 'cincinnati': 'US', 'kansas city': 'US', 'st. louis': 'US',
    'new orleans': 'US', 'buffalo': 'US', 'salt lake city': 'US', 'richmond': 'US',
    '纽约': 'US', '洛杉矶': 'US', '旧金山': 'US', '芝加哥': 'US', '休斯顿': 'US',
    '费城': 'US', '达拉斯': 'US', '西雅图': 'US', '波士顿': 'US', '迈阿密': 'US',
    '亚特兰大': 'US', '拉斯维加斯': 'US', '华盛顿': 'US', '底特律': 'US',
    '丹佛': 'US', '波特兰': 'US', '明尼阿波利斯': 'US', '匹兹堡': 'US',
    // 美国州
    'alabama': 'US', 'alaska': 'US', 'arizona': 'US', 'arkansas': 'US', 'california': 'US',
    'colorado': 'US', 'connecticut': 'US', 'delaware': 'US', 'florida': 'US',
    'hawaii': 'US', 'idaho': 'US', 'illinois': 'US', 'indiana': 'US', 'iowa': 'US',
    'kansas': 'US', 'kentucky': 'US', 'louisiana': 'US', 'maine': 'US', 'maryland': 'US',
    'massachusetts': 'US', 'michigan': 'US', 'minnesota': 'US', 'mississippi': 'US',
    'missouri': 'US', 'montana': 'US', 'nebraska': 'US', 'nevada': 'US', 'new hampshire': 'US',
    'new jersey': 'US', 'new mexico': 'US', 'north carolina': 'US', 'north dakota': 'US',
    'ohio': 'US', 'oklahoma': 'US', 'oregon': 'US', 'pennsylvania': 'US', 'rhode island': 'US',
    'south carolina': 'US', 'south dakota': 'US', 'tennessee': 'US', 'texas': 'US',
    'utah': 'US', 'vermont': 'US', 'virginia': 'US', 'west virginia': 'US',
    'wisconsin': 'US', 'wyoming': 'US',
    // 美国州缩写
    'al': 'US', 'ak': 'US', 'az': 'US', 'ar': 'US',
    'co': 'US', 'ct': 'US', 'fl': 'US',
    'ga': 'US', 'hi': 'US', 'ia': 'US',
    'il': 'US', 'ks': 'US', 'ky': 'US',
    'mi': 'US', 'mn': 'US', 'ms': 'US', 'mo': 'US',
    'mt': 'US', 'ne': 'US', 'nv': 'US', 'nh': 'US',
    'nj': 'US', 'nm': 'US', 'ny': 'US', 'nc': 'US', 'nd': 'US',
    'oh': 'US', 'ok': 'US', 'or': 'US', 'pa': 'US', 'ri': 'US',
    'sc': 'US', 'sd': 'US', 'tn': 'US', 'tx': 'US',
    'ut': 'US', 'vt': 'US', 'va': 'US', 'wa': 'US', 'wv': 'US',
    'wi': 'US', 'wy': 'US',

    // 日本
    'tokyo': 'JP', 'osaka': 'JP', 'kyoto': 'JP', 'yokohama': 'JP', 'nagoya': 'JP',
    'sapporo': 'JP', 'kobe': 'JP', 'fukuoka': 'JP', 'hiroshima': 'JP', 'sendai': 'JP',
    '东京': 'JP', '大阪': 'JP', '京都': 'JP', '横滨': 'JP', '名古屋': 'JP',
    '神户': 'JP', '福冈': 'JP', '札幌': 'JP', '广岛': 'JP',
    // 韩国
    'seoul': 'KR', 'busan': 'KR', 'incheon': 'KR', 'daegu': 'KR', 'daejeon': 'KR',
    '首尔': 'KR', '釜山': 'KR', '仁川': 'KR',
    // 英国
    'london': 'GB', 'manchester': 'GB', 'birmingham': 'GB', 'leeds': 'GB', 'glasgow': 'GB',
    'liverpool': 'GB', 'edinburgh': 'GB', 'bristol': 'GB', 'cardiff': 'GB', 'belfast': 'GB',
    'sheffield': 'GB', 'nottingham': 'GB', 'cambridge': 'GB', 'oxford': 'GB',
    '伦敦': 'GB', '曼彻斯特': 'GB', '伯明翰': 'GB', '爱丁堡': 'GB', '利物浦': 'GB',
    'england': 'GB', 'scotland': 'GB', 'wales': 'GB', 'northern ireland': 'GB',
    // 德国
    'berlin': 'DE', 'munich': 'DE', 'münchen': 'DE', 'hamburg': 'DE', 'frankfurt': 'DE',
    'cologne': 'DE', 'köln': 'DE', 'düsseldorf': 'DE', 'stuttgart': 'DE', 'dortmund': 'DE',
    'essen': 'DE', 'leipzig': 'DE', 'bremen': 'DE', 'dresden': 'DE', 'hanover': 'DE',
    '柏林': 'DE', '慕尼黑': 'DE', '汉堡': 'DE', '法兰克福': 'DE',
    // 法国
    'paris': 'FR', 'marseille': 'FR', 'lyon': 'FR', 'toulouse': 'FR', 'nice': 'FR',
    'nantes': 'FR', 'strasbourg': 'FR', 'montpellier': 'FR', 'bordeaux': 'FR', 'lille': 'FR',
    '巴黎': 'FR', '马赛': 'FR', '里昂': 'FR',
    // 意大利
    'rome': 'IT', 'roma': 'IT', 'milan': 'IT', 'milano': 'IT', 'naples': 'IT', 'napoli': 'IT',
    'turin': 'IT', 'torino': 'IT', 'florence': 'IT', 'firenze': 'IT', 'venice': 'IT', 'venezia': 'IT',
    'bologna': 'IT', 'genoa': 'IT', 'genova': 'IT', 'palermo': 'IT',
    '罗马': 'IT', '米兰': 'IT', '威尼斯': 'IT', '佛罗伦萨': 'IT',
    // 西班牙
    'madrid': 'ES', 'barcelona': 'ES', 'valencia': 'ES', 'seville': 'ES', 'sevilla': 'ES',
    'bilbao': 'ES', 'malaga': 'ES', 'zaragoza': 'ES',
    '马德里': 'ES', '巴塞罗那': 'ES',
    // 澳大利亚
    'sydney': 'AU', 'melbourne': 'AU', 'brisbane': 'AU', 'perth': 'AU', 'adelaide': 'AU',
    'gold coast': 'AU', 'canberra': 'AU', 'hobart': 'AU', 'darwin': 'AU',
    '悉尼': 'AU', '墨尔本': 'AU', '布里斯班': 'AU', '堪培拉': 'AU',
    'new south wales': 'AU', 'nsw': 'AU', 'victoria': 'AU', 'vic': 'AU', 'queensland': 'AU',
    'qld': 'AU', 'western australia': 'AU', 'south australia': 'AU', 'tasmania': 'AU',
    // 加拿大
    'toronto': 'CA', 'vancouver': 'CA', 'montreal': 'CA', 'montréal': 'CA', 'calgary': 'CA',
    'edmonton': 'CA', 'ottawa': 'CA', 'winnipeg': 'CA', 'quebec city': 'CA', 'halifax': 'CA',
    '多伦多': 'CA', '温哥华': 'CA', '蒙特利尔': 'CA', '渥太华': 'CA',
    'ontario': 'CA', 'quebec': 'CA', 'british columbia': 'CA', 'alberta': 'CA',
    'manitoba': 'CA', 'saskatchewan': 'CA', 'nova scotia': 'CA',
    // 印度
    'mumbai': 'IN', 'delhi': 'IN', 'new delhi': 'IN', 'bangalore': 'IN', 'bengaluru': 'IN',
    'hyderabad': 'IN', 'chennai': 'IN', 'kolkata': 'IN', 'pune': 'IN', 'ahmedabad': 'IN',
    'jaipur': 'IN', 'lucknow': 'IN', 'surat': 'IN',
    '孟买': 'IN', '新德里': 'IN', '班加罗尔': 'IN',
    // 巴西
    'são paulo': 'BR', 'sao paulo': 'BR', 'rio de janeiro': 'BR', 'brasilia': 'BR',
    'salvador': 'BR', 'fortaleza': 'BR', 'belo horizonte': 'BR', 'recife': 'BR',
    '圣保罗': 'BR', '里约': 'BR',
    // 墨西哥
    'mexico city': 'MX', 'guadalajara': 'MX', 'monterrey': 'MX', 'cancun': 'MX',
    '墨西哥城': 'MX',
    // 俄罗斯
    'moscow': 'RU', 'москва': 'RU', 'saint petersburg': 'RU', 'st petersburg': 'RU',
    'novosibirsk': 'RU', 'yekaterinburg': 'RU',
    '莫斯科': 'RU', '圣彼得堡': 'RU',
    // 新加坡 (城市国家)
    'singapore': 'SG', '新加坡': 'SG',
    // 台湾
    'taipei': 'TW', '台北': 'TW', '高雄': 'TW', '台中': 'TW', '台南': 'TW', 'kaohsiung': 'TW', 'taichung': 'TW',
    // 香港
    'hong kong': 'HK', '香港': 'HK', 'kowloon': 'HK', '九龙': 'HK',
    // 泰国
    'bangkok': 'TH', 'pattaya': 'TH', 'chiang mai': 'TH', 'phuket': 'TH',
    '曼谷': 'TH', '清迈': 'TH', '普吉': 'TH',
    // 越南
    'hanoi': 'VN', 'ho chi minh': 'VN', 'saigon': 'VN', 'da nang': 'VN',
    '河内': 'VN', '胡志明': 'VN',
    // 马来西亚
    'kuala lumpur': 'MY', 'penang': 'MY', 'johor bahru': 'MY',
    '吉隆坡': 'MY',
    // 印尼
    'jakarta': 'ID', 'bali': 'ID', 'surabaya': 'ID', 'bandung': 'ID',
    '雅加达': 'ID', '巴厘岛': 'ID',
    // 菲律宾 - 全部地区/省份/城市
    // NCR (马尼拉大都会)
    'manila': 'PH', 'quezon city': 'PH', 'makati': 'PH', 'taguig': 'PH', 'pasig': 'PH',
    'mandaluyong': 'PH', 'san juan': 'PH', 'marikina': 'PH', 'pasay': 'PH',
    'parañaque': 'PH', 'paranaque': 'PH', 'las piñas': 'PH', 'las pinas': 'PH',
    'muntinlupa': 'PH', 'caloocan': 'PH', 'malabon': 'PH', 'navotas': 'PH',
    'valenzuela': 'PH', 'pateros': 'PH', 'bgc': 'PH', 'bonifacio global city': 'PH',
    '马尼拉': 'PH', '马卡蒂': 'PH', '奎松城': 'PH',
    // 吕宋岛 - 中部
    'cebu': 'PH', 'cebu city': 'PH', 'lapu-lapu': 'PH', 'mandaue': 'PH',
    'bohol': 'PH', 'tagbilaran': 'PH', 'leyte': 'PH', 'tacloban': 'PH',
    'iloilo': 'PH', 'iloilo city': 'PH', 'bacolod': 'PH', 'dumaguete': 'PH',
    'negros occidental': 'PH', 'negros oriental': 'PH', 'eastern samar': 'PH',
    'western samar': 'PH', 'northern samar': 'PH', 'southern leyte': 'PH',
    'aklan': 'PH', 'antique': 'PH', 'capiz': 'PH', 'guimaras': 'PH',
    'siquijor': 'PH', 'biliran': 'PH',
    '宿务': 'PH', '宿雾': 'PH',
    // 棉兰老岛
    'davao': 'PH', 'davao city': 'PH', 'davao del sur': 'PH', 'davao del norte': 'PH',
    'davao oriental': 'PH', 'davao occidental': 'PH', 'davao de oro': 'PH',
    'cagayan de oro': 'PH', 'zamboanga': 'PH', 'zamboanga city': 'PH',
    'zamboanga del norte': 'PH', 'zamboanga del sur': 'PH', 'zamboanga sibugay': 'PH',
    'general santos': 'PH', 'gensan': 'PH', 'cotabato': 'PH', 'cotabato city': 'PH',
    'south cotabato': 'PH', 'north cotabato': 'PH',
    'bukidnon': 'PH', 'misamis oriental': 'PH', 'misamis occidental': 'PH',
    'lanao del norte': 'PH', 'lanao del sur': 'PH', 'iligan': 'PH',
    'surigao': 'PH', 'surigao del norte': 'PH', 'surigao del sur': 'PH',
    'agusan del norte': 'PH', 'agusan del sur': 'PH', 'butuan': 'PH',
    'sarangani': 'PH', 'sultan kudarat': 'PH', 'maguindanao': 'PH',
    'basilan': 'PH', 'sulu': 'PH', 'tawi-tawi': 'PH',
    'compostela valley': 'PH', 'dinagat islands': 'PH',
    'marawi': 'PH', 'kidapawan': 'PH', 'koronadal': 'PH', 'tagum': 'PH',
    'panabo': 'PH', 'digos': 'PH', 'mati': 'PH', 'tandag': 'PH', 'bislig': 'PH',
    'ozamiz': 'PH', 'oroquieta': 'PH', 'tangub': 'PH', 'dipolog': 'PH', 'pagadian': 'PH',
    '达沃': 'PH',
    // 吕宋岛 - 北部
    'baguio': 'PH', 'laoag': 'PH', 'vigan': 'PH', 'tuguegarao': 'PH',
    'santiago': 'PH', 'cauayan': 'PH', 'ilagan': 'PH',
    'ilocos norte': 'PH', 'ilocos sur': 'PH', 'la union': 'PH', 'pangasinan': 'PH',
    'dagupan': 'PH', 'san carlos': 'PH', 'urdaneta': 'PH', 'alaminos': 'PH',
    'benguet': 'PH', 'mountain province': 'PH', 'ifugao': 'PH', 'kalinga': 'PH',
    'apayao': 'PH', 'abra': 'PH', 'cagayan': 'PH', 'isabela': 'PH',
    'nueva vizcaya': 'PH', 'quirino': 'PH', 'batanes': 'PH',
    '碧瑶': 'PH',
    // 吕宋岛 - 中南部 (CALABARZON/MIMAROPA)
    'batangas': 'PH', 'batangas city': 'PH', 'lipa': 'PH', 'tanauan': 'PH',
    'cavite': 'PH', 'cavite city': 'PH', 'bacoor': 'PH', 'imus': 'PH',
    'dasmariñas': 'PH', 'dasmarinas': 'PH', 'general trias': 'PH',
    'laguna': 'PH', 'san pablo': 'PH', 'santa rosa': 'PH', 'biñan': 'PH', 'binan': 'PH',
    'calamba': 'PH', 'cabuyao': 'PH', 'los baños': 'PH', 'los banos': 'PH',
    'rizal': 'PH', 'antipolo': 'PH', 'taytay': 'PH', 'cainta': 'PH', 'angono': 'PH',
    'quezon': 'PH', 'lucena': 'PH', 'tayabas': 'PH',
    'oriental mindoro': 'PH', 'occidental mindoro': 'PH',
    'marinduque': 'PH', 'romblon': 'PH', 'palawan': 'PH', 'puerto princesa': 'PH',
    'el nido': 'PH', 'coron': 'PH',
    // 吕宋岛 - Bicol
    'albay': 'PH', 'legazpi': 'PH', 'naga': 'PH', 'camarines sur': 'PH',
    'camarines norte': 'PH', 'catanduanes': 'PH', 'sorsogon': 'PH', 'masbate': 'PH',
    'iriga': 'PH', 'ligao': 'PH', 'tabaco': 'PH',
    // 吕宋岛 - 中央 (Central Luzon)
    'bulacan': 'PH', 'malolos': 'PH', 'meycauayan': 'PH', 'san jose del monte': 'PH',
    'pampanga': 'PH', 'angeles': 'PH', 'angeles city': 'PH', 'san fernando': 'PH',
    'clark': 'PH', 'tarlac': 'PH', 'tarlac city': 'PH',
    'nueva ecija': 'PH', 'cabanatuan': 'PH', 'gapan': 'PH', 'palayan': 'PH',
    'zambales': 'PH', 'olongapo': 'PH', 'subic': 'PH', 'bataan': 'PH', 'balanga': 'PH',
    'aurora': 'PH', 'baler': 'PH',
    // 土耳其
    'istanbul': 'TR', 'ankara': 'TR', 'izmir': 'TR', 'antalya': 'TR',
    '伊斯坦布尔': 'TR', '安卡拉': 'TR',
    // 阿联酋
    'dubai': 'AE', 'abu dhabi': 'AE', '迪拜': 'AE', '阿布扎比': 'AE',
    // 以色列
    'tel aviv': 'IL', 'jerusalem': 'IL', '特拉维夫': 'IL', '耶路撒冷': 'IL',
    // 沙特
    'riyadh': 'SA', 'jeddah': 'SA', 'mecca': 'SA', '利雅得': 'SA', '麦加': 'SA',
    // 南非
    'cape town': 'ZA', 'johannesburg': 'ZA', 'durban': 'ZA', 'pretoria': 'ZA',
    '开普敦': 'ZA', '约翰内斯堡': 'ZA',
    // 埃及
    'cairo': 'EG', 'alexandria': 'EG', '开罗': 'EG',
    // 新西兰
    'auckland': 'NZ', 'wellington': 'NZ', 'christchurch': 'NZ',
    '奥克兰': 'NZ', '惠灵顿': 'NZ',
    // 荷兰
    'amsterdam': 'NL', 'rotterdam': 'NL', 'the hague': 'NL', 'utrecht': 'NL',
    '阿姆斯特丹': 'NL', '鹿特丹': 'NL',
    // 瑞士
    'zurich': 'CH', 'zürich': 'CH', 'geneva': 'CH', 'bern': 'CH', 'basel': 'CH',
    '苏黎世': 'CH', '日内瓦': 'CH',
    // 瑞典
    'stockholm': 'SE', 'gothenburg': 'SE', 'malmö': 'SE',
    '斯德哥尔摩': 'SE',
    // 挪威
    'oslo': 'NO', 'bergen': 'NO', '奥斯陆': 'NO',
    // 丹麦
    'copenhagen': 'DK', '哥本哈根': 'DK',
    // 芬兰
    'helsinki': 'FI', '赫尔辛基': 'FI',
    // 波兰
    'warsaw': 'PL', 'krakow': 'PL', 'kraków': 'PL', 'wroclaw': 'PL', 'gdansk': 'PL',
    '华沙': 'PL', '克拉科夫': 'PL',
    // 捷克
    'prague': 'CZ', 'praha': 'CZ', 'brno': 'CZ',
    '布拉格': 'CZ',
    // 奥地利
    'vienna': 'AT', 'wien': 'AT', 'salzburg': 'AT', 'innsbruck': 'AT',
    '维也纳': 'AT',
    // 葡萄牙
    'lisbon': 'PT', 'lisboa': 'PT', 'porto': 'PT',
    '里斯本': 'PT',
    // 爱尔兰
    'dublin': 'IE', '都柏林': 'IE',
    // 希腊
    'athens': 'GR', 'thessaloniki': 'GR',
    '雅典': 'GR',
    // 比利时
    'brussels': 'BE', 'bruxelles': 'BE', 'antwerp': 'BE',
    '布鲁塞尔': 'BE',
    // 阿根廷
    'buenos aires': 'AR', '布宜诺斯艾利斯': 'AR',
    // 哥伦比亚
    'bogota': 'CO', 'bogotá': 'CO', 'medellin': 'CO', 'medellín': 'CO', 'cali': 'CO', 'barranquilla': 'CO',
    '波哥大': 'CO',
    // 智利
    'valparaiso': 'CL', '圣地亚哥': 'CL',
    // 秘鲁
    'lima': 'PE', 'cusco': 'PE', 'arequipa': 'PE', '利马': 'PE',
    // === 大规模补充：印度 ===
    'gurgaon': 'IN', 'noida': 'IN', 'chandigarh': 'IN', 'indore': 'IN', 'bhopal': 'IN',
    'visakhapatnam': 'IN', 'patna': 'IN', 'vadodara': 'IN', 'nagpur': 'IN', 'ranchi': 'IN',
    'coimbatore': 'IN', 'kochi': 'IN', 'trivandrum': 'IN', 'thiruvananthapuram': 'IN',
    'guwahati': 'IN', 'bhubaneswar': 'IN', 'dehradun': 'IN', 'agra': 'IN', 'varanasi': 'IN',
    'kanpur': 'IN', 'mysore': 'IN', 'mysuru': 'IN', 'madurai': 'IN', 'salem': 'IN',
    'rajkot': 'IN', 'jodhpur': 'IN', 'udaipur': 'IN', 'amritsar': 'IN', 'ludhiana': 'IN',
    'nashik': 'IN', 'aurangabad': 'IN', 'thane': 'IN', 'navi mumbai': 'IN', 'goa': 'IN',
    'shimla': 'IN', 'srinagar': 'IN', 'jammu': 'IN', 'vijayawada': 'IN',
    '加尔各答': 'IN', '金奈': 'IN', '海德拉巴': 'IN', '浦那': 'IN', '艾哈迈达巴德': 'IN',
    // 印度邦
    'maharashtra': 'IN', 'karnataka': 'IN', 'tamil nadu': 'IN', 'telangana': 'IN',
    'gujarat': 'IN', 'rajasthan': 'IN', 'uttar pradesh': 'IN', 'west bengal': 'IN',
    'kerala': 'IN', 'punjab': 'IN', 'haryana': 'IN', 'madhya pradesh': 'IN',
    'bihar': 'IN', 'odisha': 'IN', 'assam': 'IN', 'jharkhand': 'IN',
    'andhra pradesh': 'IN', 'chhattisgarh': 'IN', 'uttarakhand': 'IN',
    // === 东南亚补充 ===
    // 越南
    'hai phong': 'VN', 'can tho': 'VN', 'nha trang': 'VN', 'hue': 'VN', 'vung tau': 'VN',
    '岘港': 'VN', '芽庄': 'VN',
    // 泰国
    'nonthaburi': 'TH', 'nakhon rathchasima': 'TH', 'hat yai': 'TH', 'udon thani': 'TH',
    'krabi': 'TH', 'koh samui': 'TH', '芭提雅': 'TH',
    // 印尼
    'medan': 'ID', 'makassar': 'ID', 'semarang': 'ID', 'palembang': 'ID', 'yogyakarta': 'ID',
    'malang': 'ID', 'balikpapan': 'ID', 'batam': 'ID', 'lombok': 'ID',
    '万隆': 'ID', '泗水': 'ID', '日惹': 'ID',

    // 马来西亚
    'george town': 'MY', 'ipoh': 'MY', 'shah alam': 'MY', 'petaling jaya': 'MY',
    'kota kinabalu': 'MY', 'kuching': 'MY', 'malacca': 'MY', 'melaka': 'MY',
    '槟城': 'MY', '沙巴': 'MY',
    // 缅甸
    'yangon': 'MM', 'mandalay': 'MM', 'naypyidaw': 'MM', '仰光': 'MM', '曼德勒': 'MM',
    // 柬埔寨
    'phnom penh': 'KH', 'siem reap': 'KH', '金边': 'KH', '暹粒': 'KH',
    // === 中东补充 ===
    'doha': 'QA', '多哈': 'QA',
    'muscat': 'OM', '马斯喀特': 'OM',
    'manama': 'BH', '麦纳麦': 'BH',
    'amman': 'JO', '安曼': 'JO',
    'beirut': 'LB', '贝鲁特': 'LB',
    'damascus': 'SY', '大马士革': 'SY',
    'tehran': 'IR', 'isfahan': 'IR', 'shiraz': 'IR', 'tabriz': 'IR', 'mashhad': 'IR',
    '德黑兰': 'IR',
    'baghdad': 'IQ', 'basra': 'IQ', 'erbil': 'IQ', '巴格达': 'IQ',
    'medina': 'SA', 'dammam': 'SA',
    'sharjah': 'AE', 'ajman': 'AE',
    // === 非洲主要城市 ===
    // 尼日利亚
    'lagos': 'NG', 'abuja': 'NG', 'kano': 'NG', 'ibadan': 'NG', 'port harcourt': 'NG',
    '拉各斯': 'NG', '阿布贾': 'NG',
    // 肯尼亚
    'nairobi': 'KE', 'mombasa': 'KE', '内罗毕': 'KE',
    // 埃塞俄比亚
    'addis ababa': 'ET', '亚的斯亚贝巴': 'ET',
    // 坦桑尼亚
    'dar es salaam': 'TZ', 'dodoma': 'TZ', 'zanzibar': 'TZ',
    // 加纳
    'accra': 'GH', 'kumasi': 'GH', '阿克拉': 'GH',
    // 摩洛哥
    'casablanca': 'MA', 'marrakech': 'MA', 'rabat': 'MA', 'fez': 'MA', 'tangier': 'MA',
    '卡萨布兰卡': 'MA', '马拉喀什': 'MA',
    // 突尼斯
    'tunis': 'TN', '突尼斯城': 'TN',
    // 阿尔及利亚
    'algiers': 'DZ', 'oran': 'DZ', '阿尔及尔': 'DZ',
    // 南非更多
    'bloemfontein': 'ZA', 'east london': 'ZA', 'port elizabeth': 'ZA', 'soweto': 'ZA',
    // 乌干达
    'kampala': 'UG', '坎帕拉': 'UG',
    // 塞内加尔
    'dakar': 'SN', '达喀尔': 'SN',
    // 科特迪瓦
    'abidjan': 'CI', '阿比让': 'CI',
    // 喀麦隆
    'douala': 'CM', 'yaounde': 'CM', 'yaoundé': 'CM',
    // 马达加斯加
    'antananarivo': 'MG',
    // 刚果金
    'kinshasa': 'CD', '金沙萨': 'CD',
    // 安哥拉
    'luanda': 'AO', '罗安达': 'AO',
    // 莫桑比克
    'maputo': 'MZ',
    // 津巴布韦
    'harare': 'ZW', 'bulawayo': 'ZW',
    // 赞比亚
    'lusaka': 'ZM',
    // === 东欧补充 ===
    // 乌克兰
    'kyiv': 'UA', 'kiev': 'UA', 'kharkiv': 'UA', 'odessa': 'UA', 'lviv': 'UA', 'dnipro': 'UA',
    '基辅': 'UA',
    // 俄罗斯更多
    'kazan': 'RU', 'nizhny novgorod': 'RU', 'samara': 'RU', 'omsk': 'RU',
    'chelyabinsk': 'RU', 'rostov': 'RU', 'ufa': 'RU', 'volgograd': 'RU',
    'perm': 'RU', 'krasnoyarsk': 'RU', 'sochi': 'RU', 'vladivostok': 'RU',
    '喀山': 'RU', '索契': 'RU', '海参崴': 'RU',
    // 罗马尼亚
    'bucharest': 'RO', 'bucuresti': 'RO', 'cluj': 'RO', 'timisoara': 'RO', 'iasi': 'RO',
    '布加勒斯特': 'RO',
    // 匈牙利
    'budapest': 'HU', 'debrecen': 'HU', '布达佩斯': 'HU',
    // 塞尔维亚
    'belgrade': 'RS', 'novi sad': 'RS', '贝尔格莱德': 'RS',
    // 克罗地亚
    'zagreb': 'HR', 'split': 'HR', 'dubrovnik': 'HR', '萨格勒布': 'HR',
    // 保加利亚
    'sofia': 'BG', 'plovdiv': 'BG', 'varna': 'BG', '索菲亚': 'BG',
    // 斯洛伐克
    'bratislava': 'SK', '布拉迪斯拉发': 'SK',
    // 斯洛文尼亚
    'ljubljana': 'SI', '卢布尔雅那': 'SI',
    // 立陶宛
    'vilnius': 'LT', 'kaunas': 'LT', '维尔纽斯': 'LT',
    // 拉脱维亚
    'riga': 'LV', '里加': 'LV',
    // 爱沙尼亚
    'tallinn': 'EE', '塔林': 'EE',
    // 白俄罗斯
    'minsk': 'BY', '明斯克': 'BY',
    // 格鲁吉亚
    'tbilisi': 'GE', 'batumi': 'GE', '第比利斯': 'GE',
    // === 拉丁美洲补充 ===
    // 巴西更多
    'curitiba': 'BR', 'manaus': 'BR', 'belem': 'BR', 'porto alegre': 'BR',
    'goiania': 'BR', 'campinas': 'BR', 'florianopolis': 'BR', 'natal': 'BR',
    '巴西利亚': 'BR', '库里蒂巴': 'BR',
    // 阿根廷更多
    'cordoba': 'AR', 'córdoba': 'AR', 'rosario': 'AR', 'mendoza': 'AR', 'mar del plata': 'AR',
    '科尔多瓦': 'AR',
    // 墨西哥更多
    'puebla': 'MX', 'tijuana': 'MX', 'leon': 'MX', 'queretaro': 'MX', 'merida': 'MX',
    'acapulco': 'MX', 'playa del carmen': 'MX', 'oaxaca': 'MX',
    // 委内瑞拉
    'caracas': 'VE', 'maracaibo': 'VE', '加拉加斯': 'VE',
    // 厄瓜多尔
    'quito': 'EC', 'guayaquil': 'EC', '基多': 'EC',
    // 乌拉圭
    'montevideo': 'UY', '蒙得维的亚': 'UY',
    // 巴拉圭
    'asuncion': 'PY', 'asunción': 'PY',
    // 玻利维亚
    'la paz': 'BO', 'santa cruz': 'BO', '拉巴斯': 'BO',
    // 中美洲
    'guatemala city': 'GT', 'panama city': 'PA', 'havana': 'CU',
    'santo domingo': 'DO',
    'tegucigalpa': 'HN', 'managua': 'NI', 'san salvador': 'SV',
    '哈瓦那': 'CU', '金斯敦': 'JM',
    // === 更多欧洲二线城市 ===
    // 英国更多
    'southampton': 'GB', 'leicester': 'GB', 'coventry': 'GB', 'hull': 'GB',
    'plymouth': 'GB', 'stoke': 'GB', 'wolverhampton': 'GB', 'derby': 'GB',
    'swansea': 'GB', 'exeter': 'GB', 'york': 'GB', 'bath': 'GB', 'brighton': 'GB',
    'norwich': 'GB', 'aberdeen': 'GB', 'dundee': 'GB', 'inverness': 'GB',
    // 德国更多
    'nuremberg': 'DE', 'nürnberg': 'DE', 'bonn': 'DE', 'mannheim': 'DE',
    'karlsruhe': 'DE', 'augsburg': 'DE', 'wiesbaden': 'DE', 'aachen': 'DE',
    'münster': 'DE', 'freiburg': 'DE', 'rostock': 'DE', 'mainz': 'DE',
    'heidelberg': 'DE', 'potsdam': 'DE', 'lübeck': 'DE', 'kiel': 'DE',
    // 法国更多
    'rennes': 'FR', 'reims': 'FR', 'grenoble': 'FR', 'rouen': 'FR', 'toulon': 'FR',
    'clermont-ferrand': 'FR', 'dijon': 'FR', 'angers': 'FR', 'le mans': 'FR',
    'brest': 'FR', 'tours': 'FR', 'amiens': 'FR', 'perpignan': 'FR',
    // 意大利更多
    'verona': 'IT', 'padova': 'IT', 'padua': 'IT', 'brescia': 'IT',
    'catania': 'IT', 'bari': 'IT', 'messina': 'IT', 'modena': 'IT',
    'parma': 'IT', 'siena': 'IT', 'pisa': 'IT', 'perugia': 'IT',
    'bergamo': 'IT', 'cagliari': 'IT', 'trieste': 'IT', 'como': 'IT',
    // 西班牙更多
    'granada': 'ES', 'alicante': 'ES', 'san sebastian': 'ES',
    'palma': 'ES', 'santa cruz de tenerife': 'ES', 'las palmas': 'ES',
    'valladolid': 'ES', 'vigo': 'ES', 'murcia': 'ES', 'cadiz': 'ES',
    // 荷兰更多
    'eindhoven': 'NL', 'tilburg': 'NL', 'groningen': 'NL', 'almere': 'NL',
    'breda': 'NL', 'nijmegen': 'NL', 'haarlem': 'NL', 'arnhem': 'NL',
    // === 中亚/高加索 ===
    'almaty': 'KZ', 'astana': 'KZ', 'nur-sultan': 'KZ', '阿拉木图': 'KZ', '阿斯塔纳': 'KZ',
    'tashkent': 'UZ', '塔什干': 'UZ',
    'ashgabat': 'TM', 'bishkek': 'KG', 'dushanbe': 'TJ',
    'baku': 'AZ', '巴库': 'AZ',
    'yerevan': 'AM', '埃里温': 'AM',
    '乌兰巴托': 'MN', 'ulaanbaatar': 'MN',
    // === 日本更多 ===
    'kawasaki': 'JP', 'kitakyushu': 'JP', 'chiba': 'JP', 'sakai': 'JP',
    'niigata': 'JP', 'hamamatsu': 'JP', 'kumamoto': 'JP', 'sagamihara': 'JP',
    'shizuoka': 'JP', 'okayama': 'JP', 'kanazawa': 'JP', 'okinawa': 'JP',
    'nara': 'JP', 'nagasaki': 'JP', 'matsuyama': 'JP', 'kagoshima': 'JP',
    '千叶': 'JP', '新潟': 'JP', '冲绳': 'JP', '奈良': 'JP', '长崎': 'JP', '熊本': 'JP',
    '静冈': 'JP', '金泽': 'JP', '冈山': 'JP',
    // === 韩国更多 ===
    'gwangju': 'KR', 'ulsan': 'KR', 'suwon': 'KR', 'changwon': 'KR',
    'goyang': 'KR', 'seongnam': 'KR', 'cheongju': 'KR', 'jeonju': 'KR',
    'jeju': 'KR', 'anyang': 'KR', 'pyeongtaek': 'KR',
    '光州': 'KR', '蔚山': 'KR', '济州': 'KR', '水原': 'KR', '大田': 'KR', '大邱': 'KR',
    // === 巴基斯坦 ===
    'karachi': 'PK', 'lahore': 'PK', 'islamabad': 'PK', 'rawalpindi': 'PK',
    'faisalabad': 'PK', 'multan': 'PK', 'peshawar': 'PK', 'quetta': 'PK',
    '卡拉奇': 'PK', '拉合尔': 'PK', '伊斯兰堡': 'PK',
    // === 孟加拉 ===
    'dhaka': 'BD', 'chittagong': 'BD', 'khulna': 'BD', 'sylhet': 'BD',
    '达卡': 'BD',
    // === 斯里兰卡 ===
    'colombo': 'LK', 'kandy': 'LK', 'galle': 'LK',
    '科伦坡': 'LK',
    // === 澳大利亚更多 ===
    'cairns': 'AU', 'townsville': 'AU', 'geelong': 'AU', 'ballarat': 'AU',
    'bendigo': 'AU', 'wollongong': 'AU', 'newcastle': 'AU', 'toowoomba': 'AU',
    'launceston': 'AU', 'sunshine coast': 'AU', 'alice springs': 'AU',
    // === 加拿大更多 ===
    'saskatoon': 'CA', 'regina': 'CA', 'kelowna': 'CA',
    'kitchener': 'CA', 'barrie': 'CA',
    'abbotsford': 'CA', 'st. johns': 'CA', 'moncton': 'CA', 'thunder bay': 'CA',
    'fredericton': 'CA', 'charlottetown': 'CA', 'yellowknife': 'CA', 'whitehorse': 'CA',
    // === 更多美国城市 ===
    'scottsdale': 'US', 'boise': 'US', 'spokane': 'US', 'tacoma': 'US',
    'des moines': 'US', 'baton rouge': 'US', 'little rock': 'US', 'charleston': 'US',
    'savannah': 'US', 'ann arbor': 'US', 'madison': 'US', 'boulder': 'US',
    'fort worth': 'US', 'el paso': 'US', 'corpus christi': 'US', 'lubbock': 'US',
    'chandler': 'US', 'gilbert': 'US', 'glendale': 'US', 'north las vegas': 'US',
    'henderson': 'US', 'chesapeake': 'US', 'norfolk': 'US', 'fremont': 'US',
    'garland': 'US', 'irving': 'US', 'hialeah': 'US', 'laredo': 'US',
    'reno': 'US', 'durham': 'US', 'greensboro': 'US', 'winston-salem': 'US',
    'akron': 'US', 'rochester': 'US', 'providence': 'US', 'hartford': 'US',
    'stamford': 'US', 'newark': 'US', 'jersey city': 'US', 'trenton': 'US',
    'knoxville': 'US', 'chattanooga': 'US', 'dayton': 'US', 'tallahassee': 'US',
    'fort lauderdale': 'US', 'st. petersburg': 'US', 'cape coral': 'US',
    'anchorage': 'US', 'juneau': 'US', 'fairbanks': 'US',
    // === 文莱 ===
    'bandar seri begawan': 'BN',
    // === 马尔代夫 ===
    'male': 'MV', '马累': 'MV',
    // === 尼泊尔 ===
    'kathmandu': 'NP', 'pokhara': 'NP', '加德满都': 'NP',
    // === 朝鲜 ===
    'pyongyang': 'KP', '平壤': 'KP',
    // === 大洋洲更多 ===
    'suva': 'FJ', 'port moresby': 'PG', 'apia': 'WS',
    'noumea': 'NC', 'papeete': 'PF',

};

// 构建查找索引
let _lookupMap: Map<string, string> | null = null;

function buildLookup(): Map<string, string> {
    if (_lookupMap) return _lookupMap;
    _lookupMap = new Map();

    // 添加国家名称（中文、英文、本地名）
    for (const [code, [cn, en]] of Object.entries(COUNTRIES)) {
        _lookupMap.set(cn.toLowerCase(), code);
        _lookupMap.set(en.toLowerCase(), code);
        // 英文别名
        if (en === 'United States') {
            _lookupMap.set('usa', code);
            _lookupMap.set('u.s.a.', code);
            _lookupMap.set('u.s.', code);
            _lookupMap.set('us', code);
            _lookupMap.set('united states of america', code);
            _lookupMap.set('美利坚', code);
        }
        if (en === 'United Kingdom') {
            _lookupMap.set('uk', code);
            _lookupMap.set('u.k.', code);
            _lookupMap.set('great britain', code);
            _lookupMap.set('britain', code);
        }
        if (en === 'UAE') {
            _lookupMap.set('united arab emirates', code);
        }
        if (en === 'South Korea') {
            _lookupMap.set('korea', code);
            _lookupMap.set('republic of korea', code);
        }
    }

    // 添加城市
    for (const [city, code] of Object.entries(CITY_TO_COUNTRY)) {
        _lookupMap.set(city.toLowerCase(), code);
    }

    return _lookupMap;
}

// 邮编模式 → 国家
const ZIP_PATTERNS: [RegExp, string][] = [
    [/\b\d{5}(-\d{4})?\b/, 'US'],       // 12345 or 12345-6789
    [/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i, 'CA'],  // K1A 0B1
    [/\b\d{3}-\d{4}\b/, 'JP'],          // 123-4567
    [/\b\d{6}\b/, 'CN'],                // 100000 (CN/IN 共用，优先CN)
    [/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i, 'GB'],  // SW1A 1AA
];

export function classifyAddress(address: string): GeoResult {
    const original = address;
    if (!address || !address.trim()) {
        return { original, country: '未知', countryCode: '', continent: '未知', confidence: 'unknown' };
    }

    const lookup = buildLookup();
    const lower = address.toLowerCase().trim();

    // 1. 完整匹配（整个地址就是一个城市/国家名）
    const directMatch = lookup.get(lower);
    if (directMatch) {
        const info = COUNTRIES[directMatch];
        if (info) {
            return {
                original, country: `${info[0]} ${info[1]}`, countryCode: directMatch,
                continent: CONTINENTS[info[2]] || info[2], confidence: 'high'
            };
        }
    }

    // 2. 从末尾开始匹配（地址最后通常是国家或州）
    const parts = lower.split(/[,，\s/\\|;；。.]+/).map(p => p.trim()).filter(Boolean);

    // 反向遍历 parts，先匹配国家级别
    for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i];
        const match = lookup.get(part);
        if (match && COUNTRIES[match]) {
            const info = COUNTRIES[match];
            return {
                original, country: `${info[0]} ${info[1]}`, countryCode: match,
                continent: CONTINENTS[info[2]] || info[2], confidence: 'high'
            };
        }
        // 两个词组合
        if (i > 0) {
            const combo = parts[i - 1] + ' ' + parts[i];
            const comboMatch = lookup.get(combo);
            if (comboMatch && COUNTRIES[comboMatch]) {
                const info = COUNTRIES[comboMatch];
                return {
                    original, country: `${info[0]} ${info[1]}`, countryCode: comboMatch,
                    continent: CONTINENTS[info[2]] || info[2], confidence: 'high'
                };
            }
        }
        // 三个词组合
        if (i > 1) {
            const combo3 = parts[i - 2] + ' ' + parts[i - 1] + ' ' + parts[i];
            const combo3Match = lookup.get(combo3);
            if (combo3Match && COUNTRIES[combo3Match]) {
                const info = COUNTRIES[combo3Match];
                return {
                    original, country: `${info[0]} ${info[1]}`, countryCode: combo3Match,
                    continent: CONTINENTS[info[2]] || info[2], confidence: 'high'
                };
            }
        }
    }

    // 3. 任意位置匹配（更宽松）
    for (const part of parts) {
        const match = lookup.get(part);
        if (match && COUNTRIES[match]) {
            const info = COUNTRIES[match];
            return {
                original, country: `${info[0]} ${info[1]}`, countryCode: match,
                continent: CONTINENTS[info[2]] || info[2], confidence: 'medium'
            };
        }
    }

    // 4. 邮编模式匹配
    for (const [pattern, code] of ZIP_PATTERNS) {
        if (pattern.test(address)) {
            const info = COUNTRIES[code];
            if (info) {
                return {
                    original, country: `${info[0]} ${info[1]}`, countryCode: code,
                    continent: CONTINENTS[info[2]] || info[2], confidence: 'low'
                };
            }
        }
    }

    // 5. 全文搜索（子串匹配，最后的兜底）
    for (const [key, code] of lookup.entries()) {
        if (key.length >= 3 && lower.includes(key)) {
            const info = COUNTRIES[code];
            if (info) {
                return {
                    original, country: `${info[0]} ${info[1]}`, countryCode: code,
                    continent: CONTINENTS[info[2]] || info[2], confidence: 'low'
                };
            }
        }
    }

    return { original, country: '未知', countryCode: '', continent: '未知', confidence: 'unknown' };
}

// 批量分类 - 使用 chunks 避免阻塞
export function classifyBatch(addresses: string[], onProgress?: (done: number, total: number) => void): Promise<GeoResult[]> {
    return new Promise((resolve) => {
        const results: GeoResult[] = [];
        const CHUNK = 2000;
        let i = 0;

        function processChunk() {
            const end = Math.min(i + CHUNK, addresses.length);
            for (; i < end; i++) {
                results.push(classifyAddress(addresses[i]));
            }
            onProgress?.(i, addresses.length);
            if (i < addresses.length) {
                setTimeout(processChunk, 0);
            } else {
                resolve(results);
            }
        }
        processChunk();
    });
}

// 统计
export function getStats(results: GeoResult[]) {
    const byContinent: Record<string, number> = {};
    const byCountry: Record<string, number> = {};
    let unknown = 0;

    for (const r of results) {
        if (r.confidence === 'unknown') {
            unknown++;
        } else {
            byContinent[r.continent] = (byContinent[r.continent] || 0) + 1;
            byCountry[r.country] = (byCountry[r.country] || 0) + 1;
        }
    }

    return {
        byContinent: Object.entries(byContinent).sort((a, b) => b[1] - a[1]),
        byCountry: Object.entries(byCountry).sort((a, b) => b[1] - a[1]),
        unknown,
        total: results.length,
        recognized: results.length - unknown
    };
}
