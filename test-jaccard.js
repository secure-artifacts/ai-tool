// 模拟 `CopySearchApp.tsx`
const SHINGLE_SIZE = 3;

function preprocessText(text) {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function generateShingles(text, n = SHINGLE_SIZE) {
    const processed = preprocessText(text);
    const shingles = new Set();
    
    if (processed.length < n) {
        if (processed.trim().length > 0) {
            shingles.add(processed);
        }
    } else {
        for (let i = 0; i <= processed.length - n; i++) {
            shingles.add(processed.substring(i, i + n));
        }
    }

    const cjkChars = processed.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
    if (cjkChars && cjkChars.length > 0) {
        for (let i = 0; i < cjkChars.length - 1; i++) {
            shingles.add(cjkChars[i] + cjkChars[i + 1]);
        }
        if (cjkChars.length <= 4) {
            cjkChars.forEach(c => shingles.add(c));
        }
    }

    return shingles;
}

function exactJaccard(set1, set2) {
    if (set1.size === 0 && set2.size === 0) return 0;
    let intersection = 0;
    for (const item of set1) {
        if (set2.has(item)) intersection++;
    }
    const union = set1.size + set2.size - intersection;
    return union > 0 ? intersection / union : 0;
}

const query = "圣诞节到来之前";
const cell = "圣诞节到来之前，你必须对上帝说这三件事： 如果您今天有一分钟时间为上帝祷告，请让我们祈祷，完成后请将它发送给您爱的人。1.亲爱的神感恩你，感谢你为我所经历的每次挣扎...";

const sq = generateShingles(query);
const cq = generateShingles(cell);

console.log("Query Shingles Size:", sq.size);
console.log("Cell Shingles Size:", cq.size);
console.log("Jaccard Similarity:", exactJaccard(sq, cq));
