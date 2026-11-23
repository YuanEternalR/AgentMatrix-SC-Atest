@echo off
rem AgentMatrix-SC 工作台外壳启动脚本
rem   默认：Electron 模式（需要有 node_modules\electron\dist\electron.exe）
rem   加参数 web：浏览器模式（不依赖 Electron，起一个本地小服务）
rem   加参数 check：只做自检，不打开界面

setlocal
cd /d "%~dp0"

rem 防御：若环境里残留 ELECTRON_RUN_AS_NODE=1，Electron 会当纯 Node 跑，
rem 表现为 "Cannot read properties of undefined (reading 'whenReady')" 后直接退出。
set ELECTRON_RUN_AS_NODE=

if not exist "node_modules\electron\dist\electron.exe" (
  echo [1/2] 首次运行：正在下载 Electron 运行时……
  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  if not exist "node_modules\electron" (
    call npm install --no-audit --no-fund || goto :fail
  )
  node node_modules\electron\install.js || goto :fail
)

echo [2/2] 检查后端与前端是否在线……
node -e "const c=require('./shell.config.json').agentmatrix;Promise.all([fetch(c.apiBase.replace(/\/api\/v1$/,'')+'/health').then(r=>r.ok).catch(()=>false),fetch(c.webBase).then(r=>r.ok).catch(()=>false)]).then(([a,w])=>{console.log('  AgentMatrix API:',a?'在线':'离线');console.log('  前端页面:',w?'在线':'离线');if(!a)console.log('  ⚠ 后端离线：先跑 dev up（在 agentmatrix-sc 根目录）');process.exit(a?0:1)})" || goto :warn

if /i "%~1"=="check" goto :done
if /i "%~1"=="web" (
  echo 浏览器模式：http://127.0.0.1:4180
  node server.js
  goto :done
)

echo 启动 Electron 工作台……
call npm start
goto :done

:warn
echo.
echo 后端未就绪，仍要打开界面请先启动后端：dev up
pause
exit /b 1

:fail
echo.
echo 依赖安装失败。手动重试：
echo   set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
echo   npm install ^&^& node node_modules\electron\install.js
pause
exit /b 1

:done
endlocal
