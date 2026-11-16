# 公文排版工具

参照 [GB/T 9704—2012《党政机关公文格式》](https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=F3CC9BEF482524C895FDA7A08BB4A70E) 的公文排版工具，支持实时预览、智能分页和 DOCX 导出。

🔗 **在线体验：https://hehecat.github.io/gongwen/**

📦 **离线版下载：[Releases](https://github.com/hehecat/gongwen/releases/latest)** — 下载 `gongwen.html`，双击即可使用

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhehecat%2Fgongwen)

## 功能特性

- **实时预览与版面编辑** — 输入原文后可切换到右侧「编辑」微调文字、字体、段落对齐或使用格式刷，再回到分页预览
- **移动落款或段落** — 在右侧「编辑」里把光标放入段落，点「← / →」左右微移一字，或「↑ / ↓」上下移动整段；这些改动会随 Word 导出。版头、版记和备用落款在「设置」中修改
- **相对居中对齐** — 选中落款和日期两段，点击「还原」右边的「相对居中对齐」。以日期为基准对齐，再将两段一起左移约一字半，并用 Word 段落缩进记录位置。操作会清除两段中的空白占位符，重复点击不会继续左移。
- **撤销与还原** — 在「预览」右边撤销或还原本次版面编辑，也可使用 Ctrl+Z 和 Ctrl+Y。Word 会导出当前步骤对应的版面
- **智能解析** — 自动识别公文标题、一至四级标题、主送机关、附件说明、成文日期等结构
- **标题与分项** — 「一、」「（一）」「1.」「（1）」按标题层级排版；「一是……；二是……」及「一要……，二要……」按正文分项突出，保留原有段落和标点。独立标题建议各占一行，Word 导航窗格保留正式标题层级
- **DOCX 导出** — 版面编辑、分页预览与 Word 使用相同的落款缩进、手工对齐和正文字距参数。Word 会按本机字体重新排版，发文前请核对折行、分页和印章。
- **文件导入** — 拖拽或点击导入 .docx / .txt 文件，自动提取纯文本进行格式化洗稿
- **自动净化** — 半角标点自动转全角、多余空白自动清理，无需手动操作
- **版头排版** — 发文机关标志（红色大字）、发文字号与签发人（无边框表格同行对齐）、红色分隔线
- **版记排版** — 抄送机关、印发机关与印发日期（左右对齐），首末粗线 + 中间细线
- **格式可配置** — 页边距、字体、字号、行距、首行缩进等参数均可自定义
- **国标默认值** — 方正小标宋标题、仿宋正文、三号字、29磅行距等开箱即用
- **本地草稿** — 原文、手工调整和配置保存在当前浏览器，切换模式和刷新后保留。清空草稿可移除当前文稿；涉密材料请使用单位批准的公文系统
- **PWA 支持** — 可安装为桌面应用，支持离线使用
- **单文件版本** — 构建为单个 HTML 文件，无需服务器即可双击运行

## 技术栈

- React 19 + TypeScript
- Vite 7
- [docx](https://github.com/dolanmedia/docx) — DOCX 文件生成
- [mammoth](https://github.com/mwilliamson/mammoth.js) — .docx 文件纯文本提取
- [file-saver](https://github.com/nickeahman/FileSaver.js) — 浏览器端文件下载
- GitHub Actions — 自动构建部署到 GitHub Pages & 发布离线版到 Releases

## 本地开发

```bash
npm install
npm run dev
npm test               # 运行解析、文本整理、草稿与导出测试
```

## 日期与草稿

- 成文日期使用完整年月日，例如 `2024年2月29日`。排版时校验日历日期，并去掉月、日的前导零；正文原文保留。成文日期取签发或会议通过的日期，请按实际情况填写。
- 讲话稿有副标题和开场称呼时，自动识别标题下的姓名与日期。可写成「（姓名 2026年10月15日）」一行，也可将姓名、日期分行；分行时日期自动加全角括号并居中。其他文稿可勾选「有人名日期」开启识别。
- 「整理原文」会清理粘贴产生的空行，保留正常的段落边界，并将「一是」「第一，」等分项引导句与紧随的展开说明排在同一段。若需保留段落间的一行空白，可在高级设置里关闭回车整理。
- 识别到文末成文日期时，优先采用文稿中的落款。没有识别到成文日期时，可在高级设置里填写备用落款。
- 修改原文会重新排版，右侧的手工调整会随之重建。建议先完成原文，再微调版面。

## 构建

```bash
npm run build          # 标准构建（含 PWA），产物输出到 dist/
npm run build:single   # 单文件离线构建，生成 dist/index.html（约 1MB）
npm run preview        # 本地预览构建产物
```

## 项目结构

```
src/
├── components/
│   ├── Editor/          # 文本编辑器（支持拖拽上传）
│   ├── Preview/         # A4 分页预览 (A4Page + Preview)
│   ├── SettingsModal/   # 格式配置弹窗（含版头/版记设置）
│   └── Toolbar/         # 顶部工具栏（导入/导出）
├── contexts/            # DocumentConfig 全局状态
├── exporter/            # DOCX 导出 (docxBuilder + styleFactory)
├── hooks/               # useDocumentParser / usePagination
├── parser/              # 公文文本 → AST 解析器
├── types/               # AST 节点类型 / 文档配置类型
├── utils/               # 文件导入 / 标点净化
└── constants/           # GB/T 9704 排版常量
```

## License

MIT
