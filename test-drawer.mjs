import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

  await page.goto('http://localhost:8090/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Login
  await page.fill('#login-email', process.env.TEST_EMAIL);
  await page.fill('#login-password', process.env.TEST_PASSWORD);
  await page.click('#btn-login');
  await page.waitForTimeout(3000);

  const dashboardVisible = await page.isVisible('#page-dashboard');
  const setupVisible = await page.isVisible('#page-setup');
  console.log('1. Dashboard visible:', dashboardVisible, '| Setup visible:', setupVisible);

  // Check hamburger
  const hamburger = await page.$('label[for="dashboard-drawer"]');
  const hamburgerVisible = hamburger ? await hamburger.isVisible() : false;
  console.log('2. Hamburger visible:', hamburgerVisible);

  // Drawer-side before click
  const before = await page.$eval('.drawer-side', el => {
    const s = getComputedStyle(el);
    return { vis: s.visibility, pe: s.pointerEvents };
  }).catch(() => 'N/A');
  console.log('3. Drawer-side BEFORE:', JSON.stringify(before));

  // Click hamburger
  if (hamburgerVisible) {
    await hamburger.click();
    await page.waitForTimeout(500);
    const checked = await page.isChecked('#dashboard-drawer');
    console.log('4. Checkbox checked after click:', checked);
    const after = await page.$eval('.drawer-side', el => {
      const s = getComputedStyle(el);
      return { vis: s.visibility, pe: s.pointerEvents };
    }).catch(() => 'N/A');
    console.log('5. Drawer-side AFTER:', JSON.stringify(after));
    const sidebar = await page.isVisible('#sidebar-gws-users').catch(() => false);
    console.log('6. Sidebar visible:', sidebar);
  }

  console.log('\n=== ERRORS ===');
  errors.forEach(e => console.log('  -', e));
  if (!errors.length) console.log('  None');

  await page.screenshot({ path: '/tmp/drawer-test.png', fullPage: true });
  await browser.close();
})();
