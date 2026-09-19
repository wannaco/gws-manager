import { chromium } from 'playwright';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://localhost:8090/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.fill('#login-email', process.env.TEST_EMAIL);
  await page.fill('#login-password', process.env.TEST_PASSWORD);
  await page.click('#btn-login');
  await page.waitForTimeout(3000);
  
  const hamburgerVisible = await page.isVisible('label[for="dashboard-drawer"]');
  const sidebarVisible = await page.isVisible('#sidebar-gws-users');
  console.log('Desktop - Hamburger visible (should be false):', hamburgerVisible);
  console.log('Desktop - Sidebar visible (should be true):', sidebarVisible);
  
  await page.screenshot({ path: '/tmp/desktop-test.png' });
  await browser.close();
})();
