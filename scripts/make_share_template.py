"""生成份额导入模板（宽表：基地展开成列，与你现有的表完全同构）。

固定列（每块表头都要写全）：
    物料PN | 物料名称 | 供应商名称 | 供应商代码 | 本月份额 | Q | D | C
基地列（每块自己一套，必须成对）：
    <基地>份额 | <基地>条数 | <基地>份额 | <基地>条数 …

一个 sheet 可以有多块表头上下堆叠，块与块之间留空行即可；块间基地可以不同
（第一块基地 A/B，第二块基地 C/D）。列按名字识别，不看第几列，列顺序随意。

项目与月份：模板不写死。默认取导入弹窗里选的项目 + 月份；
要一份文件导多个项目，把 sheet 改名成 `ABC-2026-11`，或在表里加「项目代码」「月份」两列。

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

FIXED = ["物料PN", "物料名称", "供应商名称", "供应商代码", "本月份额", "Q", "D", "C"]
FIXED_W = [12, 12, 13, 13, 11, 7, 7, 7]
BASE_W = 9

# 每块的基地组合 + 示例行。示例用库内真实物料，可直接试导。
# 条数（= 这个基地有几条产线）是基地属性：同一基地每一行填同一个数。
BLOCKS = [
    {
        "bases": ["A", "B"],
        "rows": [
            ("123", "侧板", "KL", "1341", None, 0.7, 1, 1, 50, 2, 80, 5),
            ("123", "侧板", "XS", "1245", None, 1, 1, 0.7, 50, 2, 20, 5),
        ],
    },
    {
        "bases": ["C", "D"],
        "rows": [
            ("456", "电芯", "KL", "1341", None, 0.7, 1, 1, 40, 3, 60, 4),
            ("456", "电芯", "XS", "1245", None, 1, 1, 0.7, 60, 3, 40, 4),
        ],
    },
]

NOTES = [
    ("填写规则", ""),
    ("1", "一个 sheet 可以有多块表头，上下堆叠，中间留空行即可。每块表头把固定列写全，再跟上这一块的基地列。"),
    ("2", "基地写在列名里：<基地>份额 + <基地>条数，必须成对出现，缺一个整批报错。"),
    ("3", "加一个基地 = 加两列（份额 + 条数），再把表头行复制一遍改列名。同一块里不要混两套基地。"),
    ("4", "「条数」= 这个基地有几条产线，属于基地不属于供应商：同一基地的每一行填同一个数；也可以只在第一家填，其余留空自动沿用。同一基地填了两个不同的数会整批报错。"),
    ("5", "每个基地内部，各供应商的「基地份额」合计 = 100%（容差 ±1%，99% 可接受）。不同基地互不相干。"),
    ("6", "「本月份额」可以留空 → 按 Σ(基地份额 × 条数) ÷ Σ该物料全部基地的条数 自动算，缺席基地按 0 计，留空一定合计 100%。填了就以填的为准。"),
    ("7", "「基地份额」「本月份额」可写 0-100（50 表示 50%）或 0-1（0.5 表示 50%），整批统一一种口径，不能混用。"),
    ("8", "Q / D / C 只允许五档：1 / 0.7 / 0.5 / 0.3 / 0。"),
    ("9", "段由物料决定，模板里不写：首次导入没有段信息时按物料主档，主档也没有就留空待补，后续在物料管理里改。一个物料只能属于一个段。"),
    ("10", "物料 PN / 供应商代码在主数据里没有时，按行内的物料名称、供应商名称自动建档并挂到该项目（已存在的只复用、不改名）。"),
    ("11", "一份文件默认 = 弹窗里选的项目 + 月份。要一次导多个项目：把 sheet 改名成 ABC-2026-11（项目代码或项目名 + 年月），或在表里加「项目代码」「月份」两列。"),
    ("12", "示例行会随导入一起建档（123 侧板 / 456 电芯）。只想导自己的数据，导入前删掉示例行。"),
]

HEAD_FILL = PatternFill("solid", fgColor="1E3A8A")
BASE_FILL = PatternFill("solid", fgColor="0F766E")
HEAD_FONT = Font(color="FFFFFF", bold=True, size=11)
SAMPLE_FONT = Font(color="6B7280", size=10)
THIN = Side(style="thin", color="D1D5DB")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def block_header(bases: list[str]) -> tuple[list[str], list[int]]:
    """固定列 + 每基地一对「X份额 / X条数」。"""
    head = list(FIXED)
    widths = list(FIXED_W)
    for b in bases:
        head += [f"{b}份额", f"{b}条数"]
        widths += [BASE_W, BASE_W]
    return head, widths


def build() -> Path:
    wb = Workbook()
    ws = wb.active
    # sheet 名不带项目：识别不到就用弹窗里选的项目与月份。
    # 想一次导多个项目 → 把这个 sheet 复制一份，名字改成「ABC-2026-11」。
    ws.title = "份额导入"

    n_base_cols = len(FIXED)
    row = 1
    base_col_start = n_base_cols + 1
    for idx, blk in enumerate(BLOCKS):
        head, widths = block_header(blk["bases"])
        if idx == 0:
            for col, (name, width) in enumerate(zip(head, widths), start=1):
                ws.column_dimensions[get_column_letter(col)].width = width

        for col, name in enumerate(head, start=1):
            cell = ws.cell(row=row, column=col, value=name)
            cell.fill = BASE_FILL if col >= base_col_start else HEAD_FILL
            cell.font = HEAD_FONT
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = BORDER
        ws.row_dimensions[row].height = 24
        row += 1

        for sample in blk["rows"]:
            for col, value in enumerate(sample, start=1):
                cell = ws.cell(row=row, column=col, value=value)
                cell.font = SAMPLE_FONT
                cell.border = BORDER
                if col >= 5:
                    cell.alignment = Alignment(horizontal="center")
                    cell.number_format = "0.##"
            row += 1

        row += 1  # 块间空行

    ws.freeze_panes = "A2"

    last = 500
    # Q / D / C 在固定列里固定为第 6/7/8 列
    dv_qdc = DataValidation(type="list", formula1='"1,0.7,0.5,0.3,0"', allow_blank=True, showDropDown=False)
    dv_qdc.error = "Q / D / C 只允许 1 / 0.7 / 0.5 / 0.3 / 0"
    dv_qdc.errorTitle = "评分不合法"
    ws.add_data_validation(dv_qdc)
    dv_qdc.add(f"F2:H{last}")

    # 条数列在基地列对里，逐个基地加整数校验
    for blk in BLOCKS:
        for i in range(len(blk["bases"])):
            col = base_col_start + i * 2 + 1  # 份额 + 1 = 条数
            letter = get_column_letter(col)
            dv = DataValidation(type="whole", operator="between", formula1="1", formula2="999", allow_blank=True)
            dv.error = "条数必须是 1-999 的整数（这个基地有几条产线）"
            dv.errorTitle = "条数不合法"
            ws.add_data_validation(dv)
            dv.add(f"{letter}2:{letter}{last}")

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
