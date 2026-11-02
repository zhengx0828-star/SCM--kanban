"""生成份额导入模板（长表：一行 = 供应商 × 段 × 基地）。

为什么是长表：宽表把基地写进列名（基地A_份额 / 基地A_线数），
同一项目分模组段与电芯段时，两段的基地集合不同 → 只能拆成两块表头上下堆叠，
而导入只解析第一行表头，第二块会被当数据行 → 整批 422。
长表把「段」「基地」降级为数据列，列数固定，段/基地随便加都不用改模板。

用法：
    python scripts/make_share_template.py
输出：
    frontend/public/templates/share-import-template.xlsx（前端「下载模板」按钮直接指向它）
"""

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "public" / "templates" / "share-import-template.xlsx"

HEADERS = [
    "物料PN",
    "物料名称",
    "供应商代码",
    "供应商名称",
    "段",
    "基地",
    "拉线数",
    "基地份额",
    "本月份额",
    "Q",
    "D",
    "C",
]
WIDTHS = [12, 14, 13, 14, 10, 12, 9, 11, 11, 7, 7, 7]

# 示例：模组段用库内真实物料（123 侧板 / 1341 KL / 1245 XS），可直接试导；
# 电芯段为格式示范（456 电芯尚未建物料，导入前需先建主数据或删掉这几行）。
SAMPLES = [
    ("123", "侧板", "1341", "KL", "模组", "基地A", 2, 50, None, 0.7, 1, 1),
    ("123", "侧板", "1341", "KL", "模组", "基地B", 5, 80, None, 0.7, 1, 1),
    ("123", "侧板", "1245", "XS", "模组", "基地A", 2, 50, None, 1, 1, 0.7),
    ("123", "侧板", "1245", "XS", "模组", "基地B", 5, 20, None, 1, 1, 0.7),
    ("456", "电芯", "1341", "KL", "电芯", "基地C", 3, 40, None, 0.7, 1, 1),
    ("456", "电芯", "1341", "KL", "电芯", "基地D", 4, 60, None, 0.7, 1, 1),
    ("456", "电芯", "1245", "XS", "电芯", "基地C", 3, 60, None, 1, 1, 0.7),
    ("456", "电芯", "1245", "XS", "电芯", "基地D", 4, 40, None, 1, 1, 0.7),
]

NOTES = [
    ("填写规则", ""),
    ("1", "一行 = 一个「供应商 × 段 × 基地」。同一供应商在多个基地就写多行，不要合并单元格。"),
    ("2", "「段」由物料决定：一个物料 PN 只能属于一个段（模组 / 电芯）。首次导入会自动建档到物料主档，后续必须保持一致。"),
    ("3", "同一段内，每个基地的各供应商「基地份额」合计必须 = 100%（容差 ±1%，99% 可接受）。"),
    ("4", "「拉线数」≥ 1，必须与「基地份额」成对填写；某供应商不供该基地可写 0 份额，或直接不写这一行。"),
    ("5", "「本月份额」可留空 → 按 Σ(基地份额 × 拉线数) ÷ Σ拉线数 自动计算。"),
    ("6", "「基地份额」可写 0-100（50 表示 50%）或 0-1（0.5 表示 50%），整批统一一种口径，不能混。"),
    ("7", "Q / D / C 只允许五档：1 / 0.7 / 0.5 / 0.3 / 0。"),
    ("8", "项目与月份在导入弹窗里选择，不写在表格里；供应商代码必须是主数据里的真实代码，不按名称匹配。"),
    ("9", "示例行（456 电芯）仅示范分段写法：该物料未建主数据时导入会报「未找到供应关系」，请先建物料与供应关系，或删除示例行。"),
    ("10", "旧的宽表模板（基地A_份额 / 基地A_线数 成对两列）仍然兼容，但一个项目只能有一张表头，无法同时表达两段的不同基地。"),
]

HEAD_FILL = PatternFill("solid", fgColor="1E3A8A")
HEAD_FONT = Font(color="FFFFFF", bold=True, size=11)
SAMPLE_FONT = Font(color="6B7280", size=10)
THIN = Side(style="thin", color="D1D5DB")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def build() -> Path:
    wb = Workbook()
    ws = wb.active
    ws.title = "份额导入"

    # 表头
    for col, (name, width) in enumerate(zip(HEADERS, WIDTHS), start=1):
        cell = ws.cell(row=1, column=col, value=name)
        cell.fill = HEAD_FILL
        cell.font = HEAD_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = BORDER
        ws.column_dimensions[get_column_letter(col)].width = width
    ws.row_dimensions[1].height = 24
    ws.freeze_panes = "A2"

    # 示例数据
    for r, row in enumerate(SAMPLES, start=2):
        for col, value in enumerate(row, start=1):
            cell = ws.cell(row=r, column=col, value=value)
            cell.font = SAMPLE_FONT
            cell.border = BORDER
            if col in (7, 8, 9):
                cell.number_format = "0.##"
                cell.alignment = Alignment(horizontal="center")
            elif col in (10, 11, 12):
                cell.alignment = Alignment(horizontal="center")

    last = 500
    dv_seg = DataValidation(type="list", formula1='"模组,电芯"', allow_blank=True, showDropDown=False)
    dv_seg.error = "段由物料决定，只能填模组或电芯（新增段请先在物料主档维护）"
    dv_seg.errorTitle = "段不合法"
    ws.add_data_validation(dv_seg)
    dv_seg.add(f"E2:E{last}")

    dv_qdc = DataValidation(type="list", formula1='"1,0.7,0.5,0.3,0"', allow_blank=True, showDropDown=False)
    dv_qdc.error = "Q / D / C 只允许 1 / 0.7 / 0.5 / 0.3 / 0"
    dv_qdc.errorTitle = "评分不合法"
    ws.add_data_validation(dv_qdc)
    dv_qdc.add(f"J2:L{last}")

    dv_lines = DataValidation(type="whole", operator="between", formula1="1", formula2="999", allow_blank=True)
    dv_lines.error = "拉线数必须是 1-999 的整数"
    dv_lines.errorTitle = "拉线数不合法"
    ws.add_data_validation(dv_lines)
    dv_lines.add(f"G2:G{last}")

    # 说明页
    ws2 = wb.create_sheet("填写说明")
    ws2.column_dimensions["A"].width = 6
    ws2.column_dimensions["B"].width = 110
    title = ws2.cell(row=1, column=1, value="份额导入 · 填写规则")
    title.font = Font(bold=True, size=14, color="1E3A8A")
    ws2.merge_cells("A1:B1")
    for r, (no, text) in enumerate(NOTES, start=3):
        c1 = ws2.cell(row=r, column=1, value=no)
        c2 = ws2.cell(row=r, column=2, value=text)
        c1.font = Font(bold=True, color="1E3A8A")
        c2.alignment = Alignment(wrap_text=True, vertical="top")
        ws2.row_dimensions[r].height = 34 if len(text) > 40 else 20

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    return OUT


if __name__ == "__main__":
    path = build()
    print(f"已生成：{path}")
