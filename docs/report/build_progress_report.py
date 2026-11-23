"""生成《AgentMatrix-SC 项目进度总结报告》DOCX。

用法（用工作区的 Python 运行时）：
    python docs/report/build_progress_report.py

设计约定：
- 中文正文用宋体、标题用微软雅黑；西文用 Segoe UI（显式设置 w:eastAsia，否则中文会回退）；
- 页面 A4、左右 2.2cm 边距，图片按 15cm 宽插入（A4 可用宽度约 16.6cm）；
- 目录用 TOC 域并标 dirty，Word 打开时自动更新页码。
"""

from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / "docs" / "screenshots"
OUT = Path(__file__).resolve().parent / "AgentMatrix-SC-项目进度总结报告-20261123.docx"

BRAND = RGBColor(0x1F, 0x6F, 0xEB)
INK = RGBColor(0x16, 0x32, 0x4F)
GREY = RGBColor(0x5B, 0x67, 0x7A)
BODY_EAST = "宋体"
HEAD_EAST = "微软雅黑"
LATIN = "Segoe UI"


# --------------------------------------------------------------------------
# 基础排版工具
# --------------------------------------------------------------------------

def set_fonts(run, *, east: str = BODY_EAST, latin: str = LATIN) -> None:
    """给 run 同时设置西文与中文字体（只设 font.name 中文会回退）。"""
    run.font.name = latin
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:ascii"), latin)
    rfonts.set(qn("w:hAnsi"), latin)
    rfonts.set(qn("w:eastAsia"), east)


def style_font(style, *, east: str, latin: str, size: float, bold: bool, color: RGBColor) -> None:
    style.font.name = latin
    style.font.size = Pt(size)
    style.font.bold = bold
    style.font.color.rgb = color
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:ascii"), latin)
    rfonts.set(qn("w:hAnsi"), latin)
    rfonts.set(qn("w:eastAsia"), east)


def shade(cell, hex_color: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), hex_color)
    tc_pr.append(shd)


def set_cell_margins(table, top: int = 60, bottom: int = 60, left: int = 100, right: int = 100) -> None:
    tbl_pr = table._tbl.tblPr
    mar = OxmlElement("w:tblCellMar")
    for tag, value in (("top", top), ("bottom", bottom), ("left", left), ("right", right)):
        node = OxmlElement(f"w:{tag}")
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")
        mar.append(node)
    tbl_pr.append(mar)


def add_field(paragraph, instruction: str, placeholder: str = "") -> None:
    """插入 Word 域（PAGE / TOC 等）。"""
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    fld_begin.set(qn("w:dirty"), "true")
    run._r.append(fld_begin)

    run_instr = paragraph.add_run()
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = instruction
    run_instr._r.append(instr)

    run_sep = paragraph.add_run()
    sep = OxmlElement("w:fldChar")
    sep.set(qn("w:fldCharType"), "separate")
    run_sep._r.append(sep)

    if placeholder:
        paragraph.add_run(placeholder)

    run_end = paragraph.add_run()
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run_end._r.append(end)


def hr(paragraph) -> None:
    """段落下加一条细线，用于封面与章节分隔。"""
    ppr = paragraph._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "8")
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), "1F6FEB")
    borders.append(bottom)
    ppr.append(borders)


# --------------------------------------------------------------------------
# 内容构建
# --------------------------------------------------------------------------

class Report:
    def __init__(self) -> None:
        self.doc = Document()
        self._setup_page()
        self._setup_styles()
        self._setup_header_footer()

    # --- 版式 -------------------------------------------------------------
    def _setup_page(self) -> None:
        section = self.doc.sections[0]
        section.page_width = Cm(21)
        section.page_height = Cm(29.7)
        section.left_margin = Cm(2.2)
        section.right_margin = Cm(2.2)
        section.top_margin = Cm(2.2)
        section.bottom_margin = Cm(2.0)
        section.header_distance = Cm(1.2)
        section.footer_distance = Cm(1.1)

    def _setup_styles(self) -> None:
        styles = self.doc.styles
        normal = styles["Normal"]
        style_font(normal, east=BODY_EAST, latin=LATIN, size=10.5, bold=False, color=RGBColor(0x1F, 0x29, 0x37))
        normal.paragraph_format.line_spacing = 1.45
        normal.paragraph_format.space_after = Pt(4)

        style_font(styles["Heading 1"], east=HEAD_EAST, latin=LATIN, size=16, bold=True, color=INK)
        style_font(styles["Heading 2"], east=HEAD_EAST, latin=LATIN, size=12.5, bold=True, color=BRAND)
        style_font(styles["Heading 3"], east=HEAD_EAST, latin=LATIN, size=11, bold=True, color=GREY)

        for name, before, after in (("Heading 1", 16, 8), ("Heading 2", 12, 4), ("Heading 3", 8, 3)):
            fmt = styles[name].paragraph_format
            fmt.space_before = Pt(before)
            fmt.space_after = Pt(after)
            fmt.keep_with_next = True

    def _setup_header_footer(self) -> None:
        section = self.doc.sections[0]
        # 封面不要页眉页脚：首页单独一套，视觉上才像一份正式报告
        section.different_first_page_header_footer = True

        header = section.header.paragraphs[0]
        header.text = ""
        header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        run = header.add_run("AgentMatrix-SC 项目进度总结报告　·　2026-11-23　·　v1.0")
        set_fonts(run)
        run.font.size = Pt(8.5)
        run.font.color.rgb = GREY

        footer = section.footer.paragraphs[0]
        footer.text = ""
        footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
        prefix = footer.add_run("第 ")
        set_fonts(prefix)
        prefix.font.size = Pt(9)
        prefix.font.color.rgb = GREY
        add_field(footer, "PAGE", "1")
        suffix = footer.add_run(" 页 / 共 ")
        set_fonts(suffix)
        suffix.font.size = Pt(9)
        suffix.font.color.rgb = GREY
        add_field(footer, "NUMPAGES", "1")
        tail = footer.add_run(" 页")
        set_fonts(tail)
        tail.font.size = Pt(9)
        tail.font.color.rgb = GREY

    # --- 原子操作 ---------------------------------------------------------
    def h1(self, text: str) -> None:
        self.doc.add_heading(text, level=1)

    def h2(self, text: str) -> None:
        self.doc.add_heading(text, level=2)

    def h3(self, text: str) -> None:
        self.doc.add_heading(text, level=3)

    def p(self, text: str, *, bold_prefix: str = "", size: float | None = None,
          color: RGBColor | None = None, after: float = 4, indent: bool = False) -> None:
        paragraph = self.doc.add_paragraph()
        if indent:
            paragraph.paragraph_format.first_line_indent = Cm(0.74)
        if bold_prefix:
            head = paragraph.add_run(bold_prefix)
            set_fonts(head, east=HEAD_EAST)
            head.bold = True
            if size:
                head.font.size = Pt(size)
        run = paragraph.add_run(text)
        set_fonts(run)
        if size:
            run.font.size = Pt(size)
        if color:
            run.font.color.rgb = color
        paragraph.paragraph_format.space_after = Pt(after)

    def bullet(self, text: str, *, bold_prefix: str = "") -> None:
        paragraph = self.doc.add_paragraph(style="List Bullet")
        paragraph.paragraph_format.space_after = Pt(2)
        paragraph.paragraph_format.left_indent = Cm(0.6)
        if bold_prefix:
            head = paragraph.add_run(bold_prefix)
            set_fonts(head, east=HEAD_EAST)
            head.bold = True
        run = paragraph.add_run(text)
        set_fonts(run)

    def note(self, text: str) -> None:
        """灰色小字提示。"""
        paragraph = self.doc.add_paragraph()
        run = paragraph.add_run(text)
        set_fonts(run)
        run.font.size = Pt(9)
        run.font.color.rgb = GREY
        paragraph.paragraph_format.space_after = Pt(8)

    def table(self, headers: list[str], rows: list[list[str]], *, widths: list[float] | None = None,
              header_bg: str = "1F6FEB", font_size: float = 9.5) -> None:
        table = self.doc.add_table(rows=1, cols=len(headers))
        table.style = "Table Grid"
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = True
        set_cell_margins(table)

        head_cells = table.rows[0].cells
        for index, text in enumerate(headers):
            cell = head_cells[index]
            cell.text = ""
            paragraph = cell.paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(0)
            run = paragraph.add_run(text)
            set_fonts(run, east=HEAD_EAST)
            run.bold = True
            run.font.size = Pt(font_size)
            run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
            shade(cell, header_bg)

        for row_index, values in enumerate(rows):
            cells = table.add_row().cells
            for index, text in enumerate(values):
                cell = cells[index]
                cell.text = ""
                paragraph = cell.paragraphs[0]
                paragraph.paragraph_format.space_after = Pt(0)
                paragraph.paragraph_format.line_spacing = 1.25
                run = paragraph.add_run(str(text))
                set_fonts(run)
                run.font.size = Pt(font_size)
                if index == 0:
                    run.bold = True
            if row_index % 2 == 1:
                for cell in cells:
                    shade(cell, "F5F8FC")

        if widths:
            for row in table.rows:
                for index, width in enumerate(widths):
                    row.cells[index].width = Cm(width)

        spacer = self.doc.add_paragraph()
        spacer.paragraph_format.space_after = Pt(2)
        spacer_run = spacer.add_run("")
        spacer_run.font.size = Pt(4)

    def image(self, filename: str, caption: str, max_width_cm: float = 15.0,
              max_height_cm: float = 10.5) -> None:
        """插图：宽版按整宽放，竖版按最大高度等比缩放。

        不加高度约束时，整页截图（1440×1680）放到 15cm 宽会有 17.5cm 高，
        一页只放得下一张，后面全是空白——报告会变得很难翻。
        """
        path = SHOTS / filename
        if not path.exists():
            self.note(f"（截图缺失：{filename}）")
            return

        width_cm = max_width_cm
        try:
            from PIL import Image as PILImage

            with PILImage.open(path) as probe:
                native_w, native_h = probe.size
            if native_w and native_h and (native_h / native_w) * width_cm > max_height_cm:
                width_cm = max_height_cm * native_w / native_h
        except Exception:  # 读不到尺寸就按默认宽度放，不影响出图
            pass

        self.doc.add_picture(str(path), width=Cm(width_cm))
        last = self.doc.paragraphs[-1]
        last.alignment = WD_ALIGN_PARAGRAPH.CENTER
        last.paragraph_format.space_before = Pt(2)
        last.paragraph_format.space_after = Pt(2)

        cap = self.doc.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = cap.add_run(caption)
        set_fonts(run)
        run.font.size = Pt(8.5)
        run.font.color.rgb = GREY
        cap.paragraph_format.space_after = Pt(9)

    def page_break(self) -> None:
        self.doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    # --- 封面与目录 -------------------------------------------------------
    def cover(self) -> None:
        for _ in range(3):
            self.doc.add_paragraph()

        title = self.doc.add_paragraph()
        title.alignment = WD_ALIGN_PARAGRAPH.LEFT
        run = title.add_run("面向供应链的智能体矩阵平台")
        set_fonts(run, east=HEAD_EAST)
        run.font.size = Pt(26)
        run.bold = True
        run.font.color.rgb = INK
        title.paragraph_format.space_after = Pt(2)

        product = self.doc.add_paragraph()
        run = product.add_run("AgentMatrix-SC")
        set_fonts(run, east=HEAD_EAST)
        run.font.size = Pt(20)
        run.bold = True
        run.font.color.rgb = BRAND
        product.paragraph_format.space_after = Pt(10)

        line = self.doc.add_paragraph()
        run = line.add_run("项目进度总结报告")
        set_fonts(run, east=HEAD_EAST)
        run.font.size = Pt(15)
        run.font.color.rgb = GREY
        hr(line)

        for _ in range(6):
            self.doc.add_paragraph()

        meta = [
            ("报告日期", "2026 年 11 月 23 日"),
            ("版本", "v1.0（第 4 次迭代后）"),
            ("项目形态", "单仓库、Docker Compose 一键启动、默认离线可演示"),
            ("一句话现状", "真实数据 + 真实模型 + 真实调度 + 可追溯审计，四条业务链路跑通"),
            ("验收清单", "12 项完全满足 / 5 项部分满足 / 0 项未实现（共 17 项）"),
        ]
        for label, value in meta:
            paragraph = self.doc.add_paragraph()
            paragraph.paragraph_format.space_after = Pt(3)
            head = paragraph.add_run(f"{label}　")
            set_fonts(head, east=HEAD_EAST)
            head.font.size = Pt(10)
            head.font.color.rgb = GREY
            run = paragraph.add_run(value)
            set_fonts(run)
            run.font.size = Pt(10)
            run.font.color.rgb = RGBColor(0x1F, 0x29, 0x37)

        self.page_break()

    def toc(self) -> None:
        """目录：静态章节清单。

        为什么不用 TOC 域：域在没被 Word 刷新前只显示占位文字（LibreOffice 预览就是一整条灰条），
        而这份报告要能直接发给别人看，不能依赖对方先按 F9。
        章节结构本身就是稳定的，直接列出来更可靠；页码见页脚，需要页码时可自行插入目录。
        """
        heading = self.doc.add_paragraph()
        run = heading.add_run("目　录")
        set_fonts(run, east=HEAD_EAST)
        run.font.size = Pt(16)
        run.bold = True
        run.font.color.rgb = INK
        heading.paragraph_format.space_after = Pt(12)

        outline = [
            ("一、报告摘要", None),
            ("二、项目概况", ["2.1 目标与定位", "2.2 技术栈与部署形态", "2.3 仓库结构"]),
            ("三、当前进度总览", ["3.1 六个核心模块完成度", "3.2 四条业务链路"]),
            ("四、已实现的关键能力", [
                "4.1 智能体矩阵与可解释调度",
                "4.2 调度策略可配置",
                "4.3 技能库",
                "4.4 智能体管理",
                "4.5 工作流编排与执行语义",
                "4.6 审计与合规",
                "4.7 可观测与可视化",
                "4.8 交互体验",
            ]),
            ("五、关键设计决策与取舍", None),
            ("六、验证与证据", ["6.1 自动化验证矩阵", "6.2 界面证据"]),
            ("七、需求符合度", ["7.1 验收清单统计", "7.2 部分满足项与本轮取舍", "7.3 与规格的技术栈偏差"]),
            ("八、迭代记录", None),
            ("九、已知风险与限制", None),
            ("十、下一步计划", None),
            ("附录", ["A. 启动与验证命令", "B. 演示账号", "C. 文档索引", "D. 报告口径说明"]),
        ]

        for chapter, sections in outline:
            paragraph = self.doc.add_paragraph()
            paragraph.paragraph_format.space_before = Pt(4)
            paragraph.paragraph_format.space_after = Pt(1)
            paragraph.paragraph_format.line_spacing = 1.1
            chapter_run = paragraph.add_run(chapter)
            set_fonts(chapter_run, east=HEAD_EAST)
            chapter_run.bold = True
            chapter_run.font.size = Pt(11)
            chapter_run.font.color.rgb = INK

            for section in sections or []:
                sub = self.doc.add_paragraph()
                sub.paragraph_format.left_indent = Cm(0.9)
                sub.paragraph_format.space_after = Pt(1)
                sub.paragraph_format.line_spacing = 1.1
                sub_run = sub.add_run(section)
                set_fonts(sub_run)
                sub_run.font.size = Pt(10)
                sub_run.font.color.rgb = GREY

        self.page_break()


def build() -> Path:
    report = Report()
    report.cover()
    report.toc()

    # ================= 一、摘要 =================
    report.h1("一、报告摘要")

    report.p(
        "本项目按《面向供应链的智能体矩阵：给 DSH 的构建提示词》实现了一个可本地运行、可演示、"
        "可扩展的智能体矩阵平台。当前状态是：系统主线已全部打通——真实数据（DataCo 65,752 单）、"
        "真实模型（DeepSeek，可切 Mock 离线）、真实调度（硬过滤 + 六因子加权打分 + 大模型规划）、"
        "人工审批与恢复、步骤级追踪与审计、四条完整业务链路；界面全中文，技能与智能体可在界面里"
        "注册、测试、发版，调度策略可配置并即时生效。"
    )

    report.p(
        "与规格的对照结论：验收清单 17 条中 12 条完全满足、5 条部分满足、0 条未实现。"
        "未做满的 5 条集中在两类——① 干净机器验证（缺第二台机器）；② 有意的功能收窄"
        "（并行节点、单步调试、密钥管理页）。这些取舍在论文里需要写明理由，而不是当成缺陷藏起来。"
    )

    report.p("支撑结论的关键数字（均为实测，非估算）：", after=2)
    report.table(
        ["维度", "当前值", "说明"],
        [
            ["业务链路", "4 条", "订单延迟闭环 / 区域履约诊断 / 周度补货建议 / 承运商风险巡检"],
            ["智能体 / 技能", "15 / 15（种子）", "覆盖 8 个阶段；界面可自建并绑定、测试、发版"],
            ["矩阵覆盖", "26 / 32 格（81.25%）", "8 阶段 × 4 能力，剩余 6 个缺口用于展示「能力缺口」"],
            ["接口", "52 个路径 / 60 个操作", "OpenAPI 计数，访问 /docs 可交互调试"],
            ["数据模型", "19 张业务表 + 11 个迁移", "Alembic 可重复执行，种子幂等"],
            ["真实订单", "65,752 单", "DataCo 数据集，SHA256 可追溯"],
            ["自动化测试", "单测 128 + E2E 17 步 + 路由冒烟 18 页", "另有 3 个业务自检脚本，共 57 项断言"],
            ["审计", "18 类动作 / 13 处写入点", "只追加，数据库触发器拒绝改与删"],
        ],
    )

    # ================= 二、项目概况 =================
    report.h1("二、项目概况")

    report.h2("2.1 目标与定位")
    report.p(
        "平台把供应链中多个专业智能体组织成一张\"矩阵\"：业务人员在工作台发起任务、处理审批、跟进异常；"
        "开发者注册技能、编排工作流、发布智能体版本；管理者看见覆盖率、吞吐、成功率、成本与 SLA；"
        "运维能定位失败、重试或人工接管。平台不替换 ERP/WMS/TMS，而是通过技能层调用它们——"
        "当前用 Mock/真实公开数据实现，真实系统接入作为后续迭代。"
    )

    report.h2("2.2 技术栈与部署形态")
    report.table(
        ["层次", "选型", "备注"],
        [
            ["前端", "React 18 + TypeScript + Vite + ECharts", "ECharts 按需注册并 lazy 拆包"],
            ["后端", "FastAPI + SQLAlchemy 2 + Alembic", "API 只入队与查询，不跑长任务"],
            ["数据", "PostgreSQL 16（Redis 预留）", "17 → 19 张业务表，状态单一真相源"],
            ["执行", "数据库队列 + Worker 轮询", "以库为队列，少一个中间件（已记录偏差）"],
            ["模型", "LLM 网关：Mock / DeepSeek（OpenAI 兼容）", "环境变量切换，业务层无感"],
            ["部署", "Docker Compose（WSL2 + Docker Engine）", "5 个容器，一键启动，端口只绑 127.0.0.1"],
            ["测试", "pytest + Playwright(系统 Edge) + 自检脚本", "E2E 走真实浏览器与真实下载"],
        ],
    )

    report.h2("2.3 仓库结构")
    report.table(
        ["目录", "内容"],
        [
            ["apps/api", "FastAPI 应用：路由、服务层、执行引擎、Worker、迁移"],
            ["apps/web", "React 前端：页面、组件、图表导出、交互组件"],
            ["agentmatrix-workbench", "Electron 场景化桌面工作台：5 个场景、22 个面板，内置 DSH 引擎（端口 3083）"],
            ["infra", "docker compose（api / worker / web / postgres / redis）"],
            ["scripts", "导入、压测、取证、自检脚本（check-*.ps1、smoke-test 等）"],
            ["tests", "unit（pytest）、e2e（Playwright：业务主线 + 路由冒烟）"],
            ["dsh-plugins", "DSH 插件：把工作台能力暴露成 4 个工具"],
            ["docs", "架构、接口、调度策略、实验、演示、审计、设计指南"],
        ],
    )

    # ================= 三、进度总览 =================
    report.h1("三、当前进度总览")

    report.h2("3.1 六个核心模块完成度")
    report.table(
        ["模块", "规格要求", "现状", "证据"],
        [
            ["工作台", "角色化首页、KPI、快捷发起、待办、实时运行、全局搜索",
             "已实现（除通知中心）", "工作台截图；Ctrl+K 搜索"],
            ["智能体矩阵", "8 阶段 × 4 能力、覆盖与缺口、下钻、智能体管理",
             "已实现（热力图切换未做）", "矩阵 26/32；另有 /agents 管理页"],
            ["工作流", "可视化 DAG、校验、版本、发布、运行着色",
             "已实现（缺并行/汇聚/子流程/单步调试）", "设计器 + 版本对比 + 运行 DAG"],
            ["技能库", "HTTP/内置/SQL/MCP、试运行、Mock、故障注入、密钥脱敏",
             "已实现内置 + HTTP（SQL/MCP 未做）", "/skills 列表 + 试运行控制台"],
            ["任务分发", "多来源、打分路由、队列、重试、死信、人工接管、SLA",
             "已实现（Cron/人工接管未做）", "决策可解释 + 死信重试脚本"],
            ["监控与可视化", "Run/Step 追踪、指标、告警、五类图表、导出",
             "已实现", "仪表盘、拓扑、桑基、业务看板、PNG/CSV 导出"],
        ],
    )

    report.h2("3.2 四条业务链路")
    report.table(
        ["链路", "形态", "数据来源"],
        [
            ["订单延迟异常闭环", "查单 → 影响评估 → 智能体分析 → 条件（影响分≥3）→ 审批 → 通知", "真实订单表"],
            ["区域履约诊断与整改", "区域指标 → 按运输方式拆解 → 智能体诊断 → 条件（延迟率≥50%）→ 审批 → 整改单", "真实订单表"],
            ["周度补货建议", "需求预测 → 库存快照 → 补货量 → 条件 → 运营/管理员双人审批 → PO 草稿", "真实销量；库存由调用方传入"],
            ["承运商风险巡检", "履约信号 → 风险评分 → 智能体诊断 → 条件（风险分≥60）→ 审批 → 处置单", "真实订单表（运输方式作承运商代理）"],
        ],
    )
    report.note(
        "说明：补货链路的库存数据本系统没有 WMS 来源，因此由调用方传入，未传时按 0 处理并在返回里标注 "
        "inventory_source=not_provided——宁可标注\"没有数据\"，也不编一个数字。"
    )

    # ================= 四、关键能力 =================
    report.h1("四、已实现的关键能力")

    report.h2("4.1 智能体矩阵与可解释调度")
    report.bullet("8 个供应链阶段 × 4 类能力，共 32 格；每格显示智能体、健康点与负载，空格计入覆盖率缺口。", bold_prefix="矩阵视图：")
    report.bullet(
        "每行带投入产出表汇总系数（影响力 / 感应度 / 产出占比 / 部门数），来源 scripts/map_stages.py "
        "与 docs/experiments/matrix-stage-basis.json；2026-11-23 已把「履约交付」行对齐到最新复跑结果"
        "（68 个部门 / 1.122 / 0.941 / 0.373，旧值 81 / 1.105 / 0.890 / 0.413）。",
        bold_prefix="产业系数：",
    )
    report.bullet(
        "硬过滤（能力/状态/并发）→ 六因子加权打分（能力 35 / 成功率 20 / 负载 15 / 成本 10 / 时延 10 / 亲和 10）"
        "→ 选最高分；每次决策把因子贡献与淘汰原因落库。",
        bold_prefix="调度链路：",
    )
    report.bullet(
        "任务详情可看到\"为什么派给它\"：每个因子的原始值、权重、贡献与一句话解释；被淘汰的候选也列出原因。",
        bold_prefix="可解释性：",
    )
    report.bullet(
        "5 种策略：全大模型（质量上界）/ 固定规则（无反馈下界）/ 加权打分（默认）/ SLA 约束下成本优先 / 大模型规划 + 规则校验。",
        bold_prefix="策略集合：",
    )

    report.h2("4.2 调度策略可配置（本轮新增）")
    report.p(
        "策略与权重从环境变量搬进数据库（system_settings 表），界面可改、可试算、保存后下一次调度立即生效，"
        "Worker 无需重启。保存前做完整校验（策略名、权重非负且总和大于 0、SLA 余量与质量下限取值范围），"
        "非法输入返回 422 并给出中文原因；每次变更写审计（改前/改后）。"
    )
    report.p(
        "关键设计是\"改 → 试算 → 保存\"的闭环：试算接口用真实候选集跑一次打分，不调用真实模型、不落库，"
        "让用户在保存前就能看到\"按这套权重会选谁、每个因子贡献多少、谁被硬过滤淘汰\"。"
        "只给一个下拉框的话，用户永远不知道 35% 与 20% 意味着什么。"
    )

    report.h2("4.3 技能库")
    report.bullet("内置函数 15 个（订单/影响评估/通知/库存/供应商/履约统计/分群/整改单/需求预测/补货计算/承运商信号/风险评分/处置单/PO 草稿等），均读真实数据表。", bold_prefix="两类技能：")
    report.bullet(
        "HTTP 技能默认 Mock：不联网、不要 Key，响应按模板返回，可配置延迟；关掉 Mock 才发真实请求，"
        "届时受 SSRF 防护约束——拒绝回环/内网/链路本地/云元数据地址，多 A 记录任一命中即拒，域名白名单是唯一例外通道。",
        bold_prefix="HTTP 技能：",
    )
    report.bullet(
        "输入 Schema 自动生成表单；返回响应、耗时与错误分类；可临时切换 Mock（不改库）。"
        "故障注入支持瞬时/超时/业务三类，分别落到可重试、可重试、不可重试。",
        bold_prefix="试运行控制台：",
    )
    report.bullet(
        "改配置是发新版本（版本号自增，旧配置进审计快照）；被已发布智能体或工作流引用时删除返回 409 并列出引用方。",
        bold_prefix="版本与引用：",
    )
    report.bullet(
        "新增 skill_runs 表记录每次执行（含失败），列表页的平均耗时与成功率由它聚合；"
        "没有测过的技能显示\"—\"而不是 0%。",
        bold_prefix="真实指标：",
    )

    report.h2("4.4 智能体管理")
    report.bullet("新建即草稿 v1；提示词、绑定技能、变更说明可保存草稿或发布版本；发布时自动归档上一个已发布版本。", bold_prefix="版本语义：")
    report.bullet(
        "先逐个执行绑定技能（真实计时），再把输入与技能结果交给模型；轨迹里每一步都有耗时、Token 与成本。"
        "Mock 与真实模型走同一条代码路径，只是 Provider 不同。",
        bold_prefix="在线测试：",
    )
    report.bullet("优先用已发布版本，没有则用最新草稿——可以\"先测后发\"，不用为了测试污染线上。", bold_prefix="测试对象：")
    report.bullet("版本历史 + 版本对比（提示词起始差异行、技能增删、变更说明）+ 最近运行记录。", bold_prefix="辅助视图：")

    report.h2("4.5 工作流编排与执行语义")
    report.bullet("三栏编排器（节点面板 / 画布 / 配置），支持开始、结束、技能、智能体、条件、人工审批六类节点。", bold_prefix="编排：")
    report.bullet("环检测、孤立节点、缺失配置、未发布版本、审批角色不存在；错误带节点 id。", bold_prefix="校验：")
    report.bullet("运行状态机 queued → running → waiting_approval → succeeded/failed/canceled/timed_out；步骤级 attempt 与错误分类。", bold_prefix="状态：")
    report.bullet("仅瞬时/限流/上游/超时四类可重试，指数退避 + 抖动；超限进死信，可重试或忽略。", bold_prefix="重试：")

    report.h2("4.6 审计与合规（本轮新增）")
    report.p(
        "审计表只追加：接口层不提供改与删，数据库还装了两个 BEFORE 触发器——直接用 psql 执行 DELETE 会被拒绝"
        "（自检脚本实测：psql 退出码 3，条数不变）。身份存快照（当时的姓名与角色），用户改名或调岗后历史记录不变。"
        "密钥、令牌、邮箱、手机号在落库前脱敏，导出的 CSV 也不含原文。"
    )
    report.p(
        "覆盖 18 类动作 13 处写入点：登录成功与失败、建任务、发布工作流版本、审批决策、死信重试/忽略、"
        "告警规则增改删、告警确认/恢复、技能增改删、智能体增改发版、调度策略调整。业务变更与审计记录同一事务提交，"
        "避免\"改了但没留痕\"。"
    )

    report.h2("4.7 可观测与可视化")
    report.bullet("吞吐、成功率、P50/P95（区分\"执行耗时\"与\"端到端耗时\"两种口径）、成本与 Token。", bold_prefix="指标：")
    report.bullet("告警规则 = 指标 + 比较符 + 阈值 + 级别，页面显示实时当前值与是否触发。", bold_prefix="告警：")
    report.bullet("工作流 DAG、智能体矩阵、协作拓扑、任务桑基图、业务看板，全部来自真实运行与真实订单。", bold_prefix="五类图表：")
    report.bullet("ECharts 走 getDataURL 出 2 倍图；CSV 从图表 option 反推（图上是什么就导出什么）并带 UTF-8 BOM，Excel 直接可读。", bold_prefix="导出：")

    report.h2("4.8 交互体验（本轮新增）")
    report.bullet("右下角叠放、自动消失、可点击关闭；替代原先\"把整页顶下去一格\"的页内提示。", bold_prefix="Toast 反馈：")
    report.bullet("危险操作改用自定义弹窗（Esc 取消 / Enter 确认 / 焦点落在按钮上），不再用会阻塞主线程的 window.confirm。", bold_prefix="确认弹窗：")
    report.bullet("技能库、智能体、审计、运行列表加载时显示骨架屏，并区分\"没加载完\"与\"确实没有数据\"。", bold_prefix="骨架屏：")
    report.bullet(
        "Ctrl/Cmd + K 打开命令面板，一次搜任务、运行、智能体、技能、工作流，支持按编号命中，"
        "↑↓ 选择、Enter 跳转、Esc 关闭；后端 /search 返回结果时自带跳转路由。",
        bold_prefix="全局搜索：",
    )

    report.h2("4.9 场景化桌面工作台（本轮新增）")
    report.bullet(
        "agentmatrix-workbench：改造自 luanyujia-workbench 公开模板（MIT），5 个场景、22 个面板 "
        "= 21 个原生渲染器 + 1 个「DSH 会话」webview；场景为工作台总览 / 工作流设计 / 能力矩阵 / "
        "交付追踪 / 治理与策略。",
        bold_prefix="形态：",
    )
    report.bullet(
        "面板不嵌浏览器页面，数据经主进程代理（window.am.get/post），账号与 token 不进渲染层；"
        "总览里的「DSH 大脑」是原生面板，「DSH 会话」是有意内嵌的真实 DSH 引擎界面。",
        bold_prefix="原生面板：",
    )
    report.bullet(
        "打开工作台即自动拉起平台（探 8000/health，没起就在仓库根目录后台跑 dev.cmd up，启动页显示"
        "平台进度，面板请求等平台就绪）与 DSH 引擎（DSH_PORT=3083，端口在监听就复用，否则自己拉起；"
        "profile=workbench，DSH_HOME=引擎/.dsh）。",
        bold_prefix="启动：",
    )
    report.bullet(
        "内嵌 DSH 面板的精简注入采用三轨道 0px minmax(0,1fr) 0px（原来单轨道会生成隐式自动列，"
        "导致侧栏收起时对话框偏右、越打字越往左挤）；main.js 与 renderers.js 两份常量必须同步。",
        bold_prefix="布局修复：",
    )
    report.bullet(
        "tests/e2e/workbench.mjs 共 18 步：5 场景 22 面板；21 个原生面板断言 webview/iframe=0，"
        "DSH 会话面板恰好 1 个 webview；刷新后注册表不丢。",
        bold_prefix="回归：",
    )

    # ================= 五、设计决策 =================
    report.h1("五、关键设计决策与取舍")
    report.table(
        ["决策", "理由", "代价 / 风险"],
        [
            ["订单数据用真实 DataCo 数据集", "编造的种子数据经不起追问；真实数据能算出真实分布", "字段受限，库存/供应商主数据缺失"],
            ["LLM 双 Provider（Mock / DeepSeek）", "离线可演示，联网可验证真实成本与时延", "真实模型有波动与偶发超时，需重试"],
            ["数据库队列替代 Redis + Celery", "状态单一真相源；少一个中间件、少一类不一致", "吞吐上限低于专业队列（已实测并记录）"],
            ["审计只追加 + 数据库触发器", "\"不可删除\"不能只靠代码自觉，要能对数据库直接验证", "无归档策略，长期需分区或转储"],
            ["版本不可变、运行锁定版本", "线上行为可复现，事故可回溯到具体版本", "频繁改动会产生较多版本记录"],
            ["HTTP 技能默认 Mock", "演示环境不联网也能跑通，避免依赖外部系统", "真实链路需显式关闭 Mock 并配置白名单"],
            ["策略配置落库而非环境变量", "改完即生效、可试算、可审计", "多实例部署需保证读同一份配置"],
            ["前端不写死演示数据", "所有数字都能追到接口与表", "页面必须处理空状态与加载态"],
        ],
    )

    # ================= 六、验证 =================
    report.h1("六、验证与证据")

    report.h2("6.1 自动化验证矩阵")
    report.table(
        ["验证项", "命令", "结果"],
        [
            ["单元测试（容器内）", "pytest /tests/unit", "128 条通过"],
            ["单元测试（宿主机）", "python -m pytest -q", "102 条通过（ORM 用例自动跳过）"],
            ["四角色权限", "scripts\\check-rbac.ps1", "7 / 7"],
            ["审计（留痕/脱敏/权限/只追加/导出）", "scripts\\check-audit.ps1", "18 / 18"],
            ["技能与智能体（含 SSRF、引用保护）", "scripts\\check-skills-agents.ps1", "32 / 32"],
            ["端到端（业务主线）", "node tests/e2e/e2e.mjs", "17 步全通过"],
            ["路由冒烟（防白屏）", "node tests/e2e/routes.mjs", "18 个页面全通过"],
            ["工作台回归（Electron）", "node tests/e2e/workbench.mjs", "18 步：5 场景 22 面板"],
            ["类型检查", "tsc --noEmit", "无错误"],
        ],
    )

    report.page_break()
    report.h2("6.2 界面证据")
    report.p("以下为真实运行界面截图（非设计稿），均可在 docs/screenshots/ 找到原图。", after=6)
    report.image("28-workbench-zh.jpg", "图 1　工作台：KPI、待办审批、任务列表（真实数据）", 15.0)
    report.image("34-audit.png", "图 2　审计日志：只追加、可筛选、可导出，支持变更前后对照", 15.0)
    report.image("40-agent-detail.png", "图 3　智能体详情：在线测试的工具轨迹、Token/成本与版本对比", 15.0)
    report.image("41-dispatch-settings.png", "图 4　调度策略：五种策略、六因子权重与\"改 → 试算 → 保存\"闭环", 15.0)
    report.image("43-command-palette.png", "图 5　Ctrl+K 全局搜索：跨五类对象、支持编号、键盘操作", 15.0)

    # ================= 七、需求符合度 =================
    report.h1("七、需求符合度")

    report.h2("7.1 验收清单统计")
    report.p("对照规格第 17 节（17 条），逐条复核结果：12 项完全满足、5 项部分满足、0 项未实现。", after=6)
    report.table(
        ["结果", "数量", "条目"],
        [
            ["完全满足", "12", "四角色权限、工作台真实数据、创建技能、创建智能体、矩阵覆盖、任务路由、取消一致性、"
                               "审批与审计、图表真实且可导出、只读限制、单测与 E2E"],
            ["部分满足", "5", "干净环境 60 秒登录（未在第二台机器计时）、并行节点与单步调试、"
                               "密钥管理、README 干净机器验证"],
            ["未实现", "0", "—"],
        ],
    )
    report.note("注：上述 12/5/0 是逐条对应表格行数出来的，不是估算；早期版本曾误记为 9 ✅，已在审计文档中更正并说明。")

    report.h2("7.2 部分满足项与本轮取舍")
    report.table(
        ["条目", "现状", "为什么这样取舍"],
        [
            ["第 1、17 条（干净机器验证）", "仅本机验证", "缺第二台干净机器；属于验证环境问题，非功能缺失"],
            ["第 6 条（并行/汇聚节点）", "单链式 DAG", "并行会引入并发语义与竞态处理，单链足以验证调度与恢复"],
            ["第 7 条（单步调试）", "有实时状态与失败重跑", "单步需执行器暂停/单步协议，收益低于成本"],
            ["第 15 条（密钥管理页）", "密钥只走环境变量 + 配置打码", "未做密钥管理就没有页面可管；接入真实系统时一并做"],
        ],
    )

    report.h2("7.3 与规格的技术栈偏差")
    report.table(
        ["规格要求", "实际做法", "原因"],
        [
            ["Redis 队列 + Celery", "数据库队列 + Worker 轮询", "状态单一真相源，少一个中间件"],
            ["Docker Desktop", "WSL2 + Docker Engine", "镜像下载站点在本机网络不可达"],
            ["Playwright 内置浏览器", "playwright-core + 系统 Edge", "Chromium 下载不稳定"],
            ["React Flow 编排器", "自绘 SVG + 拖拽", "六类节点与校验已够用，少一个重依赖"],
        ],
    )

    # ================= 八、迭代记录 =================
    report.h1("八、迭代记录（最近六轮）")
    report.table(
        ["提交", "主题", "主要内容", "验证"],
        [
            ["0a5130b", "审计 + 图表导出", "audit_logs 表与禁改禁删触发器、脱敏、13 处写入点、/audit 页面；"
                                            "EChartCard 统一导出 PNG/CSV", "check-audit 18/18；E2E 新增 2 步"],
            ["8cb8851", "技能库 + 智能体管理", "HTTP 技能（Mock 优先 + SSRF）、试运行控制台、skill_runs、"
                                            "智能体草稿/发布/在线测试/版本对比", "check-skills-agents 32/32；E2E 新增 2 步"],
            ["e950f7a", "策略可配置 + 设计指南", "system_settings 表、/settings/dispatch、试算接口、未保存即预览；"
                                            "/guide 与 docs/design-guide.md", "11 条配置校验单测；接口实测 422"],
            ["8b8a6f5 / a483381", "交互现代化 + 白屏修复", "Toast、确认弹窗、骨架屏、Ctrl+K 搜索；"
                                            "修复调度策略页 hooks 顺序白屏，新增路由冒烟", "E2E 17 步、路由冒烟 18 页"],
            ["286f908 / 5b5acb7 / 58c442e", "内置 DSH 引擎 + DSH 会话面板", "引擎装到 引擎/、profile=workbench、"
                                            "独立 DSH_HOME、总览新增「DSH 大脑 / DSH 会话」、4 个 agentmatrix_* 工具",
                                            "真实 DSH 界面可打开；面板注入截图核对"],
            ["本轮（未提交）", "平台自启动 + DSH 面板布局修复", "打开工作台自动 dev up 起平台（启动页显示进度、"
                                            "面板等就绪）；grid 改三轨道 0px minmax(0,1fr) 0px；工作台回归扩到 22 面板 / 18 步；矩阵履约交付系数对齐 68 部门复跑值",
                                            "真实 DSH 页 715/1252 宽复现并修复；平台启动成功/失败路径实测"],
        ],
    )

    # ================= 九、风险与限制 =================
    report.h1("九、已知风险与限制")
    report.table(
        ["项", "影响", "当前应对"],
        [
            ["策略对比实验是离线仿真", "论文中\"策略优劣\"的结论来自仿真器，不是线上数据", "论文分别标注仿真与真实两种口径"],
            ["智能体路由统计量是种子值", "success_rate / avg_cost 尚未由 run_steps 滚动聚合", "字段已预留，属后续迭代"],
            ["Cron 定时触发未实现", "补货与巡检需手动或 API 触发", "演示脚本里用 API 触发"],
            ["SQL / MCP 技能未实现", "只能接内置函数与 HTTP", "创建接口直接 422 并说明原因"],
            ["在线测试为单轮", "没有多轮工具循环", "与引擎能力一致，论文中说明"],
            ["审计无归档", "长期运行表会持续增长", "记录为后续事项（分区/转储）"],
            ["路由冒烟不覆盖业务语义", "只能防白屏与崩溃", "业务正确性仍靠 E2E 与自检脚本"],
            ["工作台依赖本机 DSH 与平台", "自动拉起失败时面板无数据（显示加载失败与手动提示）",
             "启动页显示平台/引擎状态；可手动 dev up 后刷新；AM_PLATFORM=0 可退回手动"],
        ],
    )

    # ================= 十、下一步 =================
    report.h1("十、下一步计划")
    report.table(
        ["优先级", "事项", "产出", "预估"],
        [
            ["P0", "论文正文：架构章 + 实验章", "第四、五章初稿（素材已齐：architecture、dispatch-strategy、experiments）", "3–5 天"],
            ["P1", "演示彩排与截图补齐", "按 demo-script 走通十条链路；补 指南/技能库/智能体/策略 四页", "1 天"],
            ["P2", "Cron 定时触发", "schedules 表 + Worker 每分钟检查，补齐\"定时触发\"缺口", "1 天"],
            ["P2", "设置页剩余部分", "用户/密钥/队列并发/Webhook", "2 天"],
            ["P3", "UI 第二批", "表格行内编辑、详情侧滑抽屉、暗色模式", "2 天"],
            ["P3", "智能体路由统计刷新", "由 run_steps 滚动聚合 success_rate / avg_cost", "1 天"],
        ],
    )

    report.p(
        "建议顺序：先把论文写到可与系统互证的完整度（P0），再做演示彩排（P1）——"
        "彩排会暴露\"文档里写了但演示讲不清\"的地方，正好回填论文。P2/P3 属于产品化补齐，"
        "对答辩加分有限，时间紧时可只写进\"后续工作\"。"
    )

    # ================= 附录 =================
    report.h1("附录")

    report.h2("A. 启动与验证命令")
    report.table(
        ["用途", "命令"],
        [
            ["启动全部服务", "dev up"],
            ["查看容器状态", "dev ps（5 个都应是 healthy）"],
            ["健康检查", "dev health（期望 {\"status\":\"ok\"}）"],
            ["单元测试（宿主机）", "python -m pytest -q"],
            ["单元测试（容器内）", "docker compose -f infra/docker-compose.yml exec -T api python -m pytest /tests/unit -q"],
            ["权限自检", "powershell -File scripts\\check-rbac.ps1"],
            ["审计自检", "powershell -File scripts\\check-audit.ps1"],
            ["技能与智能体自检", "powershell -File scripts\\check-skills-agents.ps1"],
            ["端到端（业务）", "node tests/e2e/e2e.mjs"],
            ["路由冒烟", "node tests/e2e/routes.mjs"],
            ["工作台回归", "node tests/e2e/workbench.mjs（先退出工作台）"],
            ["起工作台", "agentmatrix-workbench\\start.cmd（平台与 DSH 引擎自动拉起）"],
        ],
    )

    report.h2("B. 演示账号")
    report.table(
        ["角色", "账号", "密码", "权限要点"],
        [
            ["管理员", "admin@agentmatrix.local", "AgentMatrix@2026", "全部权限，可代审批"],
            ["开发者", "dev@agentmatrix.local", "AgentMatrix@2026", "建技能/智能体并发布、保存工作流、调策略"],
            ["运营", "ops@agentmatrix.local", "AgentMatrix@2026", "发起任务、审批、死信处理、试运行；不能发布"],
            ["只读", "viewer@agentmatrix.local", "AgentMatrix@2026", "只读；不能建、看不到审计"],
        ],
    )

    report.h2("C. 文档索引")
    report.table(
        ["文档", "内容"],
        [
            ["docs/requirements-audit.md", "对照规格的符合度审计（最权威的进度口径）"],
            ["docs/design-guide.md", "技能/能力/智能体/策略怎么设计与注册"],
            ["docs/architecture.md", "五层架构、数据模型、接口清单、技术栈偏差"],
            ["docs/api.md", "52 条路径 / 60 个操作的字段说明与调用示例"],
            ["docs/workbench-template.md", "场景化桌面工作台（Electron）：5 场景 22 面板、DSH 会话与启动链"],
            ["docs/dispatch-strategy.md", "五种策略、实验设计、有效性威胁"],
            ["docs/experiments/", "策略对比、并发压测、真实运行取证"],
            ["docs/demo-script.md", "十条演示链路与答辩追问预案"],
            ["docs/HANDOFF.md", "交接文档：启动、约束、已知边界、下一步"],
        ],
    )

    report.h2("D. 报告口径说明")
    report.bullet("文中所有测试数字均为对应脚本的真实输出，可在报告中给出的命令下复现。")
    report.bullet("截图取自真实运行界面（localhost），未做美化或裁剪内容。")
    report.bullet("规格中未实现的部分明确写\"未实现/部分满足\"，不写成\"已完成\"。")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    report.doc.save(OUT)
    return OUT


if __name__ == "__main__":
    path = build()
    print(f"saved: {path}")
