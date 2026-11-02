"""生成供应商细分导入模板。

一行为一条评价：期间 × 物料PN × 供应商 → 12 个档位。

★ 档位只认 1 / 0.7 / 0.5 / 0.3 / 0；也接受 100 / 70 / 50 / 30 / 0 和 70% 写法（导入时 ÷100）。
★ 空白 = **未评**，和 0 分是两回事，不要用 0 填空。
★ 12 项全空的行会被拒；期间 + PN + 供应商 在同一文件里重复也会被拒。

用法：
    python scripts/make_segment_template.py
输出：
    frontend/public/templates/segment-import-template.xlsx（前端「下载模板」直接指向它）
"""

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "public" / "templates" / "segment-import-template.xlsx"

HEADERS = [
    "期间",
    "物料PN",
    "物料名称",
    "供应商代码",
    "供应商名称",
    "质量绩效",
    "交付达成率",
    "合格率",
    "成本",
    "CFT稽查",
    "质量服务分",
    "降价意愿",
    "建库意愿",
    "紧急交付",
    "沟通态度",
    "回复及时率",
    "产能弹性",
    "打分人",
    "备注",
]
WIDTHS = [10, 10, 12, 11, 12, 11, 12, 9, 8, 11, 12, 10, 10, 10, 10, 12, 10, 10, 18]

# 示例用库内真实主数据（PN 123 侧板 / 1341 KL、1245 XS；PN 345 顶盖 / 2425 AAA），
# 可原样试导；换成自己的 PN 与供应商代码即可（必须已存在于主数据）。
SAMPLES = [
    ("2026-10", "123", "侧板", "1341", "KL", 1, 1, 0.7, 0.7, 1, 1, 1, 0.7, 1, 1, 0.7, 1, "李工", "战略伙伴示范"),
    ("2026-10", "123", "侧板", "1245", "XS", 0.7, 1, 1, 0.3, 1, 0.7, 0.3, 0.5, 0.3, 0.5, 0.5, 0.3, "李工", "强势依赖示范"),
    ("2026-10", "345", "顶盖", "2425", "AAA", 0.3, 0.3, 0.5, 0.3, 0.5, 0.3, 0.3, 0.3, 0.3, 0.5, 0.3, 0.3, "王工", "观察退出示范"),
]

HELP_LINES = [
    ("怎么填", "一行 = 一个期间（月份）× 一个物料 PN × 一家供应商。同一文件里这三者不能重复，重复请合并成一行。"),
    ("期间", "YYYY-MM，例如 2026-10。空着不填时，走导入时选的月份。"),
    ("物料PN / 供应商代码", "必须是主数据里已存在的值，按代码匹配、不按名称。PN 或代码不存在会整批报错。"),
    ("档位取值", "1 优秀 / 0.7 良好 / 0.5 中性 / 0.3 差 / 0 不可接受。也接受 100 / 70 / 50 / 30 / 0 和 70% 写法。"),
    ("空白 ≠ 0", "留空表示「这一项没评」，不是 0 分。不要用 0 填空，0 是明确判负。"),
    ("12 项全空", "整行会被拒绝。至少填一项。"),
    ("缺项后果", "能力或意愿任一组有效项少于 4 项 → 该供应商进「未评级」，不上四象限。"),
    ("红黄牌", "牌按供应商挂，不在本表里填；挂了牌的供应商导入后能力/意愿一律记 0 分，档位仍按本表保存。"),
    ("整批策略", "只要有一行报错，整批都不写。改完错误行重新导入即可。"),
]


def build() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb = Workbook()
    ws = wb.active
    ws.title = "评价"

    head_fill = PatternFill("solid", fgColor="F1F5F9")
    head_font = Font(bold=True, size=10)
    for i, (name, width) in enumerate(zip(HEADERS, WIDTHS), start=1):
        cell = ws.cell(row=1, column=i, value=name)
        cell.fill = head_fill
        cell.font = head_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "A2"
    ws.row_dimensions[1].height = 22

    for r, sample in enumerate(SAMPLES, start=2):
        for c, value in enumerate(sample, start=1):
            ws.cell(row=r, column=c, value=value)

    # 12 个档位列加下拉（第 6-17 列）
    validation = DataValidation(type="list", formula1='"1,0.7,0.5,0.3,0"', allow_blank=True, showDropDown=False)
    validation.error = "只能填 1 / 0.7 / 0.5 / 0.3 / 0（或留空表示未评）"
    validation.errorTitle = "档位不合法"
    validation.prompt = "1 优秀 / 0.7 良好 / 0.5 中性 / 0.3 差 / 0 不可接受"
    validation.promptTitle = "档位"
    ws.add_data_validation(validation)
    validation.add(f"F2:Q2000")

    help_ws = wb.create_sheet("填写说明")
    help_ws.column_dimensions["A"].width = 20
    help_ws.column_dimensions["B"].width = 96
    help_ws.cell(row=1, column=1, value="条目").font = Font(bold=True, size=10)
    help_ws.cell(row=1, column=2, value="说明").font = Font(bold=True, size=10)
    for r, (key, text) in enumerate(HELP_LINES, start=2):
        help_ws.cell(row=r, column=1, value=key).alignment = Alignment(vertical="top")
        cell = help_ws.cell(row=r, column=2, value=text)
        cell.alignment = Alignment(wrap_text=True, vertical="top")

    wb.save(OUT)
    print(f"written: {OUT}")


if __name__ == "__main__":
    build()
