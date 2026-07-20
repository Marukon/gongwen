# 公文排版 web 项目长期记忆

仓库：D:\Software\Develope\WEB\gongwen ｜ React19 + TypeScript + Vite ｜ 用 `docx` 导出 Word。

## 架构（双数据源，易踩坑）
- `text`(左 textarea) → `parseGongwen` + `astToStyledHtml` → `formattedHtml` → `Preview.tsx` 以 contentEditable 渲染并允许手动编辑 → 导出时 `parseRichGongwen(formattedHtml)` → AST → `docxBuilder.buildDocument` → `Packer`。
- 导出会**重新解析**预览 HTML，因此预览中的结构性编辑（增删回车=空段落）必须在解析时保留（preserveEmptyLines），否则导出无变化。字体等 inline 样式走 runs 会被保留。

## 姓名/日期 checkbox（hasTitleNameDate）
- 配置：`DocumentConfigContext.specialOptions.hasTitleNameDate`，默认 false。
- 检测**完全由该 flag 控制**，不再做正则自动识别（已移除 `TITLE_NAME_RE`/`TITLE_DATE_RE` 回退）。
- 预览渲染由 `Preview.tsx` 用 `formattedHtml`（来自 `richText.ts` 的 `astToStyledHtml`）。`A4Page.tsx` 的 `A4Page` 组件**当前未被引用**（疑似遗留/打印用），其 `isTitleDateNode` 未接入 checkbox，未来若启用打印预览需同步。
- 样式：姓名/日期 = 楷体_GB2312/KaiTi，三号(16pt)，居中。
  - 预览：A4Page.css `.a4-title-secondary` / `.a4-title-date`
  - 导出：styleFactory `getTitleNameRunStyle` / `getTitleDateRunStyle`
  - 日期自动括号：`richText.ensureTitleDateParentheses` 与 `docxBuilder.ensureTitleDateParentheses`（两处都要同步）。

## 已知测试红灯（仓库已有，非本次引入）
sanitize 组合修复、docxBuilder 标题 Word 样式、parser 主送机关误判。改相关模块时注意别被误认为回归。

## 验证约定
用户要求改动后跑 Node 编译测试：`npm run build`（tsc -b && vite build）须通过。
