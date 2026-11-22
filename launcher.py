# -*- coding: utf-8 -*-
"""
无限暖暖 · 系统拆解书 — 本地启动器
------------------------------------------------
双击本程序即可：启动本地静态服务 → 用默认浏览器打开拆解书系统。
无外部依赖（仅标准库），可打包为单文件 exe。
"""
import os
import sys
import threading
import webbrowser
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

import tkinter as tk
from tkinter import messagebox

APP_TITLE = "无限暖暖 · 系统拆解书"
APP_SUB = "本地拆解书系统 · 启动器"
VER = "v1.0"

# 配色（与拆解书系统一致）
PAPER = "#F6F3FC"
CARD = "#FFFFFF"
LINE = "#ECE7F7"
INK = "#241B3A"
INK2 = "#4A4462"
MUTED = "#9A94AE"
VIOLET = "#7C5CFF"
VIOLET_D = "#6244D6"
VIOLET_SOFT = "#F1EBFF"
MINT = "#1B8770"
AMBER = "#B5822C"
RED = "#C4495F"
FONT = "Microsoft YaHei UI"

DEFAULT_PORT = 8763


def base_dir():
    """定位拆解书系统所在目录：exe / 脚本所在目录，找不到 index.html 时向上找两级"""
    if getattr(sys, "frozen", False):
        d = os.path.dirname(os.path.abspath(sys.executable))
    else:
        d = os.path.dirname(os.path.abspath(__file__))
    for _ in range(3):
        if os.path.exists(os.path.join(d, "index.html")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class LocalServer:
    def __init__(self, root):
        self.root = root
        self.httpd = None
        self.port = None
        self.thread = None

    def start(self, port):
        last = None
        for p in range(port, port + 40):
            try:
                handler = partial(QuietHandler, directory=self.root)
                self.httpd = ThreadingHTTPServer(("127.0.0.1", p), handler)
                self.port = p
                break
            except OSError as e:
                last = e
                continue
        if not self.httpd:
            raise RuntimeError("端口被占用：%s" % last)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        return self.port

    def stop(self):
        if self.httpd:
            try:
                self.httpd.shutdown()
                self.httpd.server_close()
            except Exception:
                pass
        self.httpd = None
        self.port = None

    @property
    def running(self):
        return self.httpd is not None

    @property
    def url(self):
        return "http://127.0.0.1:%s/index.html" % (self.port or DEFAULT_PORT)


# ---------------- 圆角按钮 ----------------
class RButton(tk.Canvas):
    KINDS = {
        "primary": (VIOLET, VIOLET_D, "#FFFFFF", VIOLET, VIOLET_D),
        "ghost": ("#FFFFFF", "#F7F2FF", INK2, "#E2DAF3", "#CBBBF3"),
        "danger": ("#FFF6F8", "#FFEBF0", RED, "#FBE0E6", "#F3B6C3"),
    }

    def __init__(self, master, text, command, kind="ghost", w=104, h=34, font_size=9):
        bg = master["bg"]
        super().__init__(master, width=w, height=h, bg=bg, highlightthickness=0, bd=0)
        self.command = command
        self.kind = kind
        self.enabled = True
        self._hover = False
        self._cw, self._ch = w, h
        self._text = text
        self._font = (FONT, font_size, "bold" if kind == "primary" else "normal")
        self.configure(cursor="hand2")
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<Button-1>", self._on_press)
        self._draw()

    def _rr(self, x1, y1, x2, y2, r, **kw):
        pts = [
            x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r,
            x2, y2 - r, x2, y2, x2 - r, y2, x1 + r, y2,
            x1, y2, x1, y2 - r, x1, y1 + r, x1, y1,
        ]
        return self.create_polygon(pts, smooth=True, **kw)

    def _draw(self):
        self.delete("all")
        base, hover, fg, border, border_hover = self.KINDS[self.kind]
        fill = hover if (self._hover and self.enabled) else base
        bd = border_hover if (self._hover and self.enabled) else border
        if not self.enabled:
            fill = "#F6F4FB"
            fg = "#BDB7CC"
            bd = "#EFEBF7"
        self._rr(1, 1, self._cw - 1, self._ch - 1, 9, fill=fill, outline=bd)
        self.create_text(self._cw / 2, self._ch / 2 - 1, text=self._text, fill=fg, font=self._font)

    def set_text(self, text, enabled=None):
        self._text = text
        if enabled is not None:
            self.enabled = enabled
            self.configure(cursor="hand2" if enabled else "arrow")
        self._draw()

    def _on_enter(self, _):
        self._hover = True
        self._draw()

    def _on_leave(self, _):
        self._hover = False
        self._draw()

    def _on_press(self, _):
        if self.enabled and self.command:
            self.command()


class Launcher(tk.Tk):
    def __init__(self):
        super().__init__()
        self.server = LocalServer(base_dir())
        self.auto_open = tk.BooleanVar(value=True)
        self.stop_on_close = tk.BooleanVar(value=True)
        self.port_var = tk.StringVar(value=str(DEFAULT_PORT))

        self.title(APP_TITLE + " · 启动器")
        self.configure(bg=PAPER)
        self.resizable(False, False)
        self._set_icon()
        self._build()
        self.after(10, self._autosize)
        self.protocol("WM_DELETE_WINDOW", self.on_close)
        self.after(220, self.start_server)

    # ---------- 外观 ----------
    def _autosize(self):
        """按实际内容计算窗口尺寸，避免高 DPI 下底部被裁掉"""
        self.update_idletasks()
        w = max(620, self.winfo_reqwidth())
        h = self.winfo_reqheight()
        sw = self.winfo_screenwidth()
        sh = self.winfo_screenheight()
        self.geometry("%dx%d+%d+%d" % (w, h, max((sw - w) // 2, 20), max((sh - h) // 2 - 40, 20)))
        self.minsize(w, h)

    def _set_icon(self):
        ico = os.path.join(base_dir(), "icon.ico")
        try:
            if os.path.exists(ico):
                self.iconbitmap(ico)
        except Exception:
            pass

    def _card(self, parent, pad=16):
        f = tk.Frame(parent, bg=CARD, highlightbackground=LINE, highlightthickness=1)
        inner = tk.Frame(f, bg=CARD)
        inner.pack(fill="both", expand=True, padx=pad, pady=pad)
        return f, inner

    def _build(self):
        # 顶部
        head = tk.Frame(self, bg=PAPER)
        head.pack(fill="x", padx=22, pady=(18, 10))

        logo = tk.Canvas(head, width=44, height=44, bg=PAPER, highlightthickness=0)
        logo.pack(side="left")
        self._round_rect(logo, 0, 0, 44, 44, 13, VIOLET)
        logo.create_text(22, 20, text="∞", fill="#FFFFFF", font=(FONT, 22, "bold"))

        txt = tk.Frame(head, bg=PAPER)
        txt.pack(side="left", padx=12)
        tk.Label(txt, text=APP_TITLE, bg=PAPER, fg=INK, font=(FONT, 14, "bold")).pack(anchor="w")
        tk.Label(txt, text=APP_SUB, bg=PAPER, fg=MUTED, font=(FONT, 9)).pack(anchor="w", pady=(1, 0))

        tk.Label(head, text=VER, bg=PAPER, fg="#BDB7CC", font=(FONT, 9)).pack(side="right")

        # 服务卡片
        card, inner = self._card(self)
        card.pack(fill="x", padx=22, pady=(4, 12))

        row = tk.Frame(inner, bg=CARD)
        row.pack(fill="x")
        self.dot = tk.Canvas(row, width=14, height=14, bg=CARD, highlightthickness=0)
        self.dot.pack(side="left", pady=2)
        self.dot_id = self.dot.create_oval(3, 3, 11, 11, fill="#CFC9DE", outline="")
        self.status = tk.Label(row, text="未启动", bg=CARD, fg=MUTED, font=(FONT, 10, "bold"))
        self.status.pack(side="left", padx=(6, 0))
        self.url_label = tk.Label(row, text="http://127.0.0.1:%s" % DEFAULT_PORT, bg=CARD, fg=MUTED, font=(FONT, 9))
        self.url_label.pack(side="right")

        tk.Label(
            inner, text="在本地启动一个只读静态服务，用浏览器打开拆解书；所有内容自动保存在浏览器本地。",
            bg=CARD, fg=INK2, font=(FONT, 9), justify="left", wraplength=520,
        ).pack(anchor="w", pady=(6, 12))

        btns = tk.Frame(inner, bg=CARD)
        btns.pack(fill="x")
        self.btn_open = RButton(btns, "启动并打开", self.start_server, "primary", w=112, h=36)
        self.btn_open.pack(side="left")
        self.btn_browse = RButton(btns, "打开页面", self.open_page, "ghost", w=96, h=36)
        self.btn_browse.pack(side="left", padx=8)
        self.btn_stop = RButton(btns, "停止服务", self.stop_server, "ghost", w=96, h=36)
        self.btn_stop.pack(side="left")
        self.btn_reload = RButton(btns, "刷新页面", self.open_page, "ghost", w=96, h=36)
        self.btn_reload.pack(side="left", padx=8)
        self.btn_dir = RButton(btns, "打开文件夹", self.open_dir, "ghost", w=104, h=36)
        self.btn_dir.pack(side="left")

        # 选项卡片
        card2, inner2 = self._card(self, pad=14)
        card2.pack(fill="x", padx=22)
        self._check(inner2, "启动后自动打开浏览器", self.auto_open).pack(anchor="w")
        self._check(inner2, "关闭窗口时停止本地服务", self.stop_on_close).pack(anchor="w", pady=(6, 0))

        port_row = tk.Frame(inner2, bg=CARD)
        port_row.pack(anchor="w", pady=(8, 0), fill="x")
        tk.Label(port_row, text="起始端口", bg=CARD, fg=INK2, font=(FONT, 9)).pack(side="left")
        ent = tk.Entry(
            port_row, textvariable=self.port_var, width=7, relief="flat",
            bg="#FBF9FF", fg=INK, font=(FONT, 9), highlightthickness=1,
            highlightbackground=LINE, highlightcolor="#CBBBF3", justify="center",
        )
        ent.pack(side="left", padx=8, ipady=3)
        tk.Label(port_row, text="被占用时自动向后尝试", bg=CARD, fg=MUTED, font=(FONT, 8)).pack(side="left")

        # 日志
        card3 = tk.Frame(self, bg=CARD, highlightbackground=LINE, highlightthickness=1)
        card3.pack(fill="both", expand=True, padx=22, pady=(12, 10))
        self.log = tk.Text(
            card3, height=4, relief="flat", bg=CARD, fg=INK2, font=(FONT, 8),
            wrap="word", padx=12, pady=8, highlightthickness=0, bd=0,
        )
        self.log.pack(fill="both", expand=True)
        self.log.configure(state="disabled")

        tip = tk.Frame(self, bg=PAPER)
        tip.pack(fill="x", padx=22, pady=(0, 14))
        tk.Label(
            tip, text="提示：内容保存在浏览器 localStorage，换电脑/清缓存前请用右上角「导出」备份 JSON。",
            bg=PAPER, fg=MUTED, font=(FONT, 8), justify="left",
        ).pack(anchor="w")

        self._sync_buttons()

    def _round_rect(self, cv, x1, y1, x2, y2, r, color):
        pts = [
            x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r,
            x2, y2 - r, x2, y2, x2 - r, y2, x1 + r, y2,
            x1, y2, x1, y2 - r, x1, y1 + r, x1, y1,
        ]
        cv.create_polygon(pts, smooth=True, fill=color, outline="")

    def _check(self, parent, text, var):
        return tk.Checkbutton(
            parent, text=text, variable=var, bg=CARD, fg=INK2, font=(FONT, 9),
            activebackground=CARD, activeforeground=INK, selectcolor="#FFFFFF",
            highlightthickness=0, bd=0, anchor="w", cursor="hand2",
        )

    # ---------- 行为 ----------
    def log_line(self, msg):
        self.log.configure(state="normal")
        self.log.insert("end", "· " + msg + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def _sync_buttons(self):
        run = self.server.running
        self.btn_browse.set_text("打开页面", enabled=run)
        self.btn_reload.set_text("刷新页面", enabled=run)
        self.btn_stop.set_text("停止服务", enabled=run)
        self.btn_open.set_text("运行中 · 打开" if run else "启动并打开", enabled=True)

    def _set_status(self, kind):
        colors = {"run": MINT, "stop": "#CFC9DE", "busy": AMBER, "err": RED}
        texts = {"run": "运行中", "stop": "未启动", "busy": "启动中…", "err": "启动失败"}
        self.dot.itemconfigure(self.dot_id, fill=colors.get(kind, "#CFC9DE"))
        self.status.configure(text=texts.get(kind, "未启动"),
                              fg={"run": MINT, "stop": MUTED, "busy": AMBER, "err": RED}.get(kind, MUTED))

    def start_server(self):
        if self.server.running:
            if self.auto_open.get():
                self.open_page()
            return
        index = os.path.join(base_dir(), "index.html")
        if not os.path.exists(index):
            messagebox.showerror("找不到页面", "同级目录下缺少 index.html。\n请把本程序与拆解书系统放在同一文件夹。")
            self._set_status("err")
            return
        try:
            port = int(self.port_var.get() or DEFAULT_PORT)
            if not (1024 <= port <= 65535):
                raise ValueError
        except ValueError:
            port = DEFAULT_PORT
            self.port_var.set(str(port))

        self._set_status("busy")
        self.update_idletasks()
        try:
            real = self.server.start(port)
        except Exception as e:
            self._set_status("err")
            messagebox.showerror("启动失败", str(e))
            return

        self._set_status("run")
        self.url_label.configure(text="http://127.0.0.1:%s" % real, fg=INK2)
        self.log_line("服务已启动：http://127.0.0.1:%s" % real)
        if real != port:
            self.log_line("端口 %s 被占用，已改用 %s" % (port, real))
        self._sync_buttons()
        if self.auto_open.get():
            self.open_page()

    def open_page(self):
        if not self.server.running:
            self.start_server()
            return
        webbrowser.open(self.server.url)
        self.log_line("已在浏览器打开页面")

    def stop_server(self):
        if not self.server.running:
            return
        self.server.stop()
        self._set_status("stop")
        self.url_label.configure(text="http://127.0.0.1:%s" % self.port_var.get(), fg=MUTED)
        self.log_line("服务已停止（页面需重新启动后才能保存）")
        self._sync_buttons()

    def open_dir(self):
        d = base_dir()
        try:
            if sys.platform.startswith("win"):
                os.startfile(d)  # noqa
            elif sys.platform == "darwin":
                os.system('open "%s"' % d)
            else:
                os.system('xdg-open "%s"' % d)
        except Exception:
            pass

    def on_close(self):
        try:
            if self.stop_on_close.get():
                self.server.stop()
        finally:
            self.destroy()


def selftest():
    """无界面自检：起服务 → 拉首页 → 退出（用于打包后验证）"""
    root = base_dir()
    s = LocalServer(root)
    port = s.start(8763)
    import urllib.request
    with urllib.request.urlopen("http://127.0.0.1:%d/index.html" % port, timeout=5) as resp:
        code = resp.status
        body = resp.read().decode("utf-8", "ignore")
    msg = "SELFTEST ok port=%s status=%s length=%s has_title=%s" % (
        port, code, len(body), "无限暖暖" in body)
    try:
        import tempfile
        with open(os.path.join(tempfile.gettempdir(), "nikki_launcher_selftest.txt"), "w", encoding="utf-8") as f:
            f.write(msg)
    except Exception:
        pass
    try:
        print(msg)
    except Exception:
        pass
    s.stop()


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
        sys.exit(0)
    try:
        import ctypes
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    app = Launcher()
    app.mainloop()
