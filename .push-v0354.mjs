// 第一百七十六/七十七/七十八轮 提交后推送脚本（不带管道，防背压假卡）
import { execSync } from 'node:child_process';
let ok = false;
for (let i = 1; i <= 8; i++) {
  try {
    const out = execSync('git push origin main --tags', { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    console.log(`push attempt ${i}: OK`, out.trim().split('\n').pop());
    ok = true; break;
  } catch (e) {
    console.log(`push attempt ${i}: FAIL`, String(e?.message).split('\n')[0]);
    execSync('sleep 45', { shell: 'C:\\Program Files\\Git\\bin\\bash.exe' });
  }
}
if (!ok) process.exit(1);
await new Promise((r) => setTimeout(r, 12000));
try {
  const res = await fetch('https://github.com/yousei1216/n.e.k.o_plugin_neko_survivors/releases/tag/v0.3.54');
  console.log('tag页:', res.status);
} catch (e) { console.log('tag 验证抖动（已推）:', String(e?.message).split('\n')[0]); }
