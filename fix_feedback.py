import re

with open('apps/sheetmind/components/ImageFormulaPanel.tsx', 'r') as f:
    content = f.read()

# 1. Remove import
content = re.sub(r"import FeedbackModal from '\./FeedbackModal';\n", "", content)

# 2. Remove state
content = re.sub(r"    const \[feedbackModalImg, setFeedbackModalImg\] = useState<ParsedImage \| null>\(null\);\n", "", content)

# 3. Handle 1770 block (Standard list needs-edit)
content = re.sub(r"setFeedbackModalImg\(img\);", r"openAnnotation(img);", content)

# 4. Handle 1990 block (ReviewCanvasView prop)
content = re.sub(r"if \(parsed\) setFeedbackModalImg\(parsed\);", r"if (parsed) openAnnotation(parsed);", content)

# 5. Handle 2250 block (DrivePlayer nested inline)
# It's already caught by regex #3 since it's `setFeedbackModalImg(img);`

# 6. Remove handleFeedbackModalSave
content = re.sub(r"    // ── Feedback modal: save ──\n.*?    }, \[feedbackModalImg, gyazoToken\]\);\n\n", "", content, flags=re.DOTALL)

# 7. Remove FeedbackModal component at the end
content = re.sub(r"            {/\* Feedback Modal \(portaled to body for z-index above canvas\) \*/}\n\s*\{feedbackModalImg && createPortal\([\s\S]*?document\.body\n\s*\)\}\n", "", content)

with open('apps/sheetmind/components/ImageFormulaPanel.tsx', 'w') as f:
    f.write(content)

