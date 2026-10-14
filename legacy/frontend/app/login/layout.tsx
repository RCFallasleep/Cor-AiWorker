/**
 * 登录页独立布局：全屏，无侧边栏和 Topbar
 * 通过在 login 目录下放 layout.tsx 覆盖父级布局中的 shell 部分
 * 注意：ThemeProvider 和 AuthProvider 仍由根 layout 提供
 */
export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
