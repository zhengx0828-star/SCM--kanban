# OPENCODE.md —— 给 opencode（及其它 AI 助手）的开场指令

> **用法**：新开对话时，把本文件全文发给 opencode；或直接对它说：
> 「先读项目根目录的 OPENCODE.md 并严格遵守。」
>
> 本文件是「开场指令」，详细规则在 `AGENT.md`；两者冲突时以 `AGENT.md` 为准。

---

你是我的开发助手，负责「SCM 供应链看板」项目（后端 FastAPI + SQLite，前端 React + Vite）。

【第一步】先完整阅读项目根目录的 AGENT.md 和 README.md，按里面的约定工作；两者冲突时以 AGENT.md 为准。

【数据红线 —— 最重要，违反会造成不可逆的数据丢失】
1. backend/products.db 是我唯一的业务数据文件（看板录入的数据）。它不在 git 里，也没有任何自动备份。
2. 严禁删除、清空、覆盖、重建 products.db；严禁删除整个项目目录；严禁重新 git clone 覆盖当前目录。
   原因：从 GitHub 下载或 clone 的版本里没有 products.db、runtime/、node_modules/，
   「用下载版顶替原目录」= 数据全没 + 系统起不来。
3. 不要为了「同步到最新」「重置环境」「重新部署」而删除或覆盖任何目录。
4. 更新代码只允许：git pull，或用项目根的 update-from-zip.bat（它会先备份 db 再换代码）。
5. 需要改数据库结构时，只允许在 backend/app/migrations.py 做幂等增量迁移（ALTER TABLE ADD COLUMN），
   严禁 DROP TABLE。
6. 执行任何删除类命令（del / rm / Remove-Item / rmdir）之前，必须先停下来问我确认。

【目录确认】先看当前工作目录里有没有 backend/products.db：
 - 有 → 这是含我数据的正式项目，按上面红线保护它。
 - 没有 → 你手上只是从 GitHub 下载的纯代码副本，请只读、只分析，不要把它复制或覆盖到别处。

【环境约定】
 - Python 一律用项目自带的 runtime\python\python.exe（不要用系统 python，不要建 venv）
 - Node/前端用项目自带的 runtime\node\node.exe 和 pnpm（不要用 npm）
 - 全部用相对路径，不要写绝对路径
 - 改 .bat 文件必须保持 GBK 编码 + CRLF 行尾（存成 UTF-8 会立刻乱码）
 - 启动方式：双击 start-all.bat（后端 8000 / 前端 80）

【工作方式】
 - 动手前先说明你打算改哪些文件、为什么
 - 改完自己验证（后端 py_compile、前端 tsc --noEmit），把结果告诉我
 - 不要顺手重构无关代码；不要改全局主数据（物料按 PN、供应商按 code 全项目共用，项目只是引用）

现在先读 AGENT.md，然后复述一遍你理解的「项目现状」和「数据红线」，确认无误后再动手。

---

## 一句话版（日常快速开场）

> 先读项目根目录的 OPENCODE.md 和 AGENT.md 并严格遵守。重点：backend/products.db 是我的唯一业务数据、不在 git 里也没备份——严禁删除、覆盖、重建它或整个项目目录，也不要重新 clone；更新代码只能用 git pull 或 update-from-zip.bat；执行任何删除类命令前必须先问我。
