/**
 * 仿真核数值断言。
 *
 * 直接从 index.html 里抽出「环节模型」与「仿真辅助」两节代码来跑，
 * 保证测的就是页面实际在用的那份实现，而不是另写一份。
 *
 *   node tests/core.test.mjs
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(join(HERE, "..", "index.html"), "utf8");

// index.html 用 /* ==== 分隔各节，取需要的两节
const blocks = html.split("/* =========================================================================");
function pick(tag) {
  const b = blocks.find((x) => x.includes(tag));
  if (!b) throw new Error("找不到代码块: " + tag);
  const end = b.indexOf("*/");          // 跳过开头的说明注释
  return end >= 0 ? b.slice(end + 2) : b;
}

const src = pick("2. 过程环节模型") + "\n" + pick("4. 仿真辅助");
const M = new Function(
  src + "\n; return {FirstOrder,Delay,LeadLag,PID,FOPDT,performance};"
)();
const { FirstOrder, Delay, PID, FOPDT, performance } = M;

const DT = 0.02;
let pass = 0, fail = 0;

function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + "  " + detail); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log("\n[FirstOrder 一阶惯性]");
{
  const o = new FirstOrder(2, 5, DT);
  let y = 0;
  for (let i = 0; i < 3000; i++) y = o.step(1);      // 60s = 12T
  ok("稳态收敛到 K=2", near(y, 2, 0.002), `y=${y.toFixed(4)}`);

  const o2 = new FirstOrder(2, 5, DT);
  for (let i = 0; i < Math.round(5 / DT); i++) o2.step(1);
  ok("一个 T 后到达 63.2%", near(o2.y / 2, 0.632, 0.01),
     `比值=${(o2.y / 2).toFixed(4)}`);
}

console.log("\n[Delay 纯滞后]");
{
  const d = new Delay(1, DT);                          // tau=1s → 50 步
  const out = [];
  for (let i = 0; i < 120; i++) out.push(d.step(i === 0 ? 1 : 0));
  ok("前 50 步输出为 0", out.slice(0, 50).every((v) => v === 0));
  ok("第 51 步出现脉冲", out[50] === 1, `out[50]=${out[50]}`);
  ok("脉冲只出现一次", out.filter((v) => v !== 0).length === 1);
}

console.log("\n[PID 纯比例]");
{
  const p = new PID(2, Infinity, 0, DT);
  ok("u = Kp·e", near(p.step(1, 0.25), 1.5, 1e-9), `u=${p.step(1, 0.25)}`);
}

console.log("\n[PID 积分消除稳态误差]");
{
  const o = new FirstOrder(1, 4, DT);
  const pid = new PID(2, 6, 0, DT, { outMax: 50, outMin: -50 });
  let y = 0;
  for (let i = 0; i < 8000; i++) { const u = pid.step(1, y); y = o.step(u); }
  ok("闭环收敛到设定值", near(y, 1, 0.01), `y=${y.toFixed(4)}`);
}

console.log("\n[PID 抗饱和]");
{
  const p = new PID(10, 2, 0, DT, { outMax: 5, outMin: 0 });
  let u = 0;
  for (let i = 0; i < 500; i++) u = p.step(1, 0);       // 长期大误差
  ok("输出不超上限", u <= 5 + 1e-9, `u=${u}`);
  ok("误差反向可退出饱和", p.step(1, 0.99) < 5, "条件积分失效");
}

console.log("\n[FOPDT 纯滞后串联]");
{
  const o = new FOPDT(1, 5, 2, DT);
  const ys = [];
  for (let i = 0; i < 1500; i++) ys.push(o.step(1));    // 30s = 6T
  const firstMove = ys.findIndex((v) => v > 1e-6);
  ok("滞后 2s 内无响应", firstMove >= 99,
     `首个非零步=${firstMove} (约 ${(firstMove * DT).toFixed(2)}s)`);
  ok("最终收敛到 K=1", near(ys.at(-1), 1, 0.02), `y=${ys.at(-1).toFixed(4)}`);
}

console.log("\n[performance 指标]");
{
  const t = Float64Array.from({ length: 1001 }, (_, i) => i * 0.01);
  const y = Float64Array.from(t, (tt) => 1 - Math.exp(-2 * tt) * Math.cos(6 * tt));
  const p = performance(t, y, 1);
  ok("能算出正超调", p.overshoot > 0, `overshoot=${p.overshoot.toFixed(1)}%`);
  ok("IAE 为正", p.iae > 0, `iae=${p.iae.toFixed(2)}`);
  ok("调节时间有限", p.ts > 0 && p.ts <= 10, `ts=${p.ts.toFixed(2)}`);
}

console.log("\n[Smith 预估：模型准确时应优于常规 PID]");
{
  // 复刻实验四的闭环结构
  function sim(withSmith, K, T, tau, kp, ti, misScale) {
    const T_end = 80, n = Math.round(T_end / DT);
    const plant = new FOPDT(K, T, tau, DT);
    const Km = K * (1 + misScale), Tm = T * (1 + misScale), taum = tau * (1 + misScale);
    const mFo = new FirstOrder(Km, Tm, DT);
    const mDl = taum > 0 ? new Delay(taum, DT) : null;
    const pid = new PID(kp, ti, 0, DT, { outMax: 20, outMin: -5 });
    const y = new Float64Array(n);
    let yPrev = 0, u = 0;
    for (let i = 0; i < n; i++) {
      let fb = yPrev;
      if (withSmith) {
        const ym0 = mFo.step(u);
        const ym0d = mDl ? mDl.step(ym0) : ym0;
        fb = yPrev + (ym0 - ym0d);
      }
      u = pid.step(1, fb);
      yPrev = plant.step(u);
      y[i] = yPrev;
    }
    return y;
  }
  const t = Float64Array.from({ length: 4000 }, (_, i) => i * DT);
  const yFb = sim(false, 1.2, 8, 5, 1.6, 10, 0);
  const ySm = sim(true, 1.2, 8, 5, 1.6, 10, 0);
  const iaeFb = performance(t, yFb, 1).iae;
  const iaeSm = performance(t, ySm, 1).iae;
  ok("Smith 的 IAE 明显更小", iaeSm < iaeFb * 0.75,
     `常规=${iaeFb.toFixed(0)} Smith=${iaeSm.toFixed(0)} 比=${(iaeSm / iaeFb).toFixed(2)}`);
  ok("两条曲线都收敛",
     near(yFb.at(-1), 1, 0.05) && near(ySm.at(-1), 1, 0.05),
     `fb=${yFb.at(-1).toFixed(3)} sm=${ySm.at(-1).toFixed(3)}`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
