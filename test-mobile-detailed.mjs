import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ 
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2.625,
  });
  
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

  await page.goto('http://localhost:8090/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  await page.fill('#login-email', process.env.TEST_EMAIL);
  await page.fill('#login-password', process.env.TEST_PASSWORD);
  await page.click('#btn-login');
  await page.waitForTimeout(3000);

  console.log('1. Dashboard visible:', await page.isVisible('#page-dashboard'));
  console.log('2. Drawer class:', await page.$eval('#main-drawer', el => el.className));

  // Find hamburger by its text content (☰)
  const hamburger = await page.$('label.btn-square');
  const hamburgerVisible = hamburger ? await hamburger.isVisible() : false;
  console.log('3. Hamburger visible:', hamburgerVisible);
  
  const box = await hamburger?.boundingBox();
  console.log('4. Hamburger box:', JSON.stringify(box));

  // What element is at the hamburger's tap point?
  if (box) {
    const elAtPoint = await page.evaluate(({x, y}) => {
      const el = document.elementFromPoint(x + 10, y + 10);
      return el ? { tag: el.tagName, class: el.className, for: el.getAttribute('for') } : null;
    }, { x: box.x, y: box.y });
    console.log('5. Element at tap point:', JSON.stringify(elAtPoint));
  }

  // Tap the hamburger
  if (hamburgerVisible) {
    await page.tap('label.btn-square');
    await page.waitForTimeout(500);
    const checked = await page.isChecked('#dashboard-drawer');
    console.log('6. Checkbox checked after TAP:', checked);
    
    // Check if sidebar items are visible and tappable
    const sidebarVisible = await page.isVisible('#sidebar-gws-users').catch(() => false);
    console.log('7. Sidebar visible:', sidebarVisible);
    
    // Check if drawer-side now has pointer-events: auto
    const sideStyle = await page.$eval('.drawer-side', el => {
      const s = getComputedStyle(el);
      return { pe: s.pointerEvents, vis: s.visibility };
    });
    console.log('8. Drawer-side style:', JSON.stringify(sideStyle));
  }

  console.log('\n=== ERRORS ===');
  errors.forEach(e => console.log('  -', e));
  if (!errors.length) console.log('  None');

  await page.screenshot({ path: '/tmp/mobile-test.png' });
  await browser.close();
})();
