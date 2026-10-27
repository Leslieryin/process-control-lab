# process-control-lab · 过程控制交互实验台

[![在线演示](https://img.shields.io/badge/demo-%E5%9C%A8%E7%BA%BF%E6%89%93%E5%BC%80-0f6cbd?style=flat-square)](https://leslieryin.github.io/process-control-lab/)
![CI](https://github.com/Leslieryin/process-control-lab/actions/workflows/ci.yml/badge.svg)
![license](https://img.shields.io/badge/license-MIT-blue)

**打开即用的单文件 HTML**——[在线直接用](https://leslieryin.github.io/process-control-lab/)，或下载 `index.html` 双击离线运行。零依赖、零框架，全部数值仿真在浏览器本地完成。

这是继 [control-lab](https://github.com/Leslieryin/control-lab)（经典控制）、[modern-control-lab](https://github.com/Leslieryin/modern-control-lab)（现代控制）之后的第三级：**前两个讲"理论上怎么算"，这一个讲"现场为什么调不出来"**。

> **EN** — Process control lab: pure dead time, Smith predictor, cascade and feedforward control — six experiments on why dead time destabilizes a loop, and when each compensator actually helps. [Try it →](https://leslieryin.github.io/process-control-lab/)

![拖动纯滞后时间 τ（2.0 → 9.0），曲线起始点后移，τ/T 判据从 0.25 变为 1.13 并提示需要补偿](docs/demo.gif)

## 为什么过程控制要单独一套

自控原理里的对象大多没有纯滞后，状态空间更是不谈滞后。但工业现场的对象几乎都是这个形状：

$$G(s) = \frac{K\,e^{-\tau s}}{Ts+1}$$

那个 $e^{-\tau s}$ 麻烦在于：**它不改变幅频特性，只不停往相频里灌滞后**。增益加到能用的程度，相位裕度已经吃光了。更别扭的是，滞后项不在闭环特征方程里——控制器发命令，要等 τ 秒才看得见后果，这期间它还会继续按错误的方向动作。

所以过程控制发展出一整套补偿结构：Smith 预估、串级、前馈。这个实验台就是把这几个结构拆开给你看。

## 六个实验

- **对象与纯滞后** —— FOPDT 阶跃响应，拖 K / T / τ。τ/T 是判断"好不好控"的第一指标：<0.2 易控，0.2~1 需补偿，>1 难控。
- **滞后对闭环的影响** —— 同一套 PID，只把 τ 放大 1~4 倍。滞后本身不改稳态，却持续吞噬稳定裕度，直到同样参数彻底发散。
- **PID 整定** —— 手调 vs Ziegler-Nichols 反应曲线法。Z-N 给的参数为什么只能当起点：实测超调远超教科书标的 25%。
- **Smith 预估补偿** —— 常规 PID vs Smith，可拖动模型失配。模型准确时收益惊人；失配 ±30% 后迅速退化——为什么现场不如串级普及。
- **串级控制** —— 单回路 vs 串级，扰动可切内/外环。内扰抑制 37%，外扰只有 2%：串级的能力边界在哪，一目了然。
- **前馈-反馈复合** —— 仅反馈 / 静态前馈 / 动态前馈。前馈不改变稳定性，它只是让反馈一开始就少干活。

每个实验都是拖滑块即时重算，图上带参考线与动态指标（超调、调节时间、IAE）。

## 和另外两个 lab 的分工

- **[control-lab](https://github.com/Leslieryin/control-lab)** —— 传递函数、根轨迹、频域。回答：给定 G(s)，闭环会怎样。
- **[modern-control-lab](https://github.com/Leslieryin/modern-control-lab)** —— 状态空间、矩阵、极点配置。回答：多变量系统怎么设计反馈。
- **process-control-lab（本仓库）** —— 一阶滞后模型、频域补偿结构。回答：对象带纯滞后时，工程上怎么救。

## 数值仿真的几个实现细节

单文件看起来简单，但要保证"拖到极限参数也不崩"，有些地方不能偷懒：

**一阶环节用精确离散解，不是欧拉。** 步长 0.02 s 对 T=1 s 的对象已经偏大，显式欧拉会有明显误差甚至振荡。这里直接用一阶惯性环节的解析解：

```js
y += (K*u - y) * (1 - Math.exp(-dt / T));
```

`u` 在一步内视为恒定时这是精确的，任意步长都不会数值发散。

**纯滞后用环形缓冲，长度取整。** `round(τ/dt)` 直接决定滞后步数，取整误差最多半步。缓冲满后 `step()` 返回 D 步前的值，先读后写。

**PID 做了三件事**，缺一不可：
- **微分先行**（对测量值微分而非误差），避免设定值阶跃时微分项打出尖峰
- **微分一阶滤波**，系数 `N=10`，否则噪声会被微分放大成锯齿
- **条件积分抗饱和**：输出顶到限幅时停止积分累积，误差反向时能立刻退出饱和（有测试断言）

**前馈补偿器作用在原始扰动上，不是扰动通道的输出。** 教科书结构是 $G_{ff} = G_d/G$，输入就该是扰动本身 $d$。如果错用通道输出 $G_d(d)$，等于多乘了一次 $K_d$——`K_d=1` 时恰好看不出来，换成 1.5 就补错了。这个坑踩过一次。

## 运行

```bash
# 方式一：直接双击 index.html
# 方式二：本地起个静态服务
python -m http.server 8000
# 打开 http://localhost:8000
```

浏览器要求：任何支持 ES2017 的现代浏览器（Canvas 2D + Float64Array）。

## 验证

```bash
node tests/core.test.mjs      # 16 项数值断言（需要 Node 20+；跑页面本身不需要 Node）
```

测试从 `index.html` 里直接抽出「环节模型」与「仿真辅助」两节代码来执行——测的就是页面实际在用的那份实现，不是另写一份。覆盖：稳态收敛、63.2% 时间常数、延迟步数、纯比例增益、积分消差、抗饱和退出、Smith 的 IAE 优势。

各实验的默认参数也逐个扫描过，确保打开页面看到的是有教学意义的曲线，而不是一条崩掉的线。比如实验四的 `Kp`/`Ti` 就是扫出来的：既要让常规 PID 有明显超调又不能发散，Smith 才衬得出效果；实验六的 `T_d` 默认取 2 s 也是同理——取 6 s 时两条通道动态特性接近，静态前馈和动态前馈会重合，看不出差别。

## 许可证

[MIT](LICENSE)
