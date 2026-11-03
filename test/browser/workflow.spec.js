import { test,expect } from '@playwright/test';

test('non-developer workflow edits visually, previews both parts, publishes and restores',async({page})=>{
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/'); await expect(page.getByRole('heading',{name:'Make yourself understood.'})).toBeVisible();
  await page.getByRole('button',{name:/Workspace welcome/}).click();
  const frame=page.frameLocator('#email');
  await expect(frame.getByRole('textbox',{name:'Headline',exact:true})).toHaveText('A good place to start');
  await frame.getByRole('textbox',{name:'Headline',exact:true}).fill('A fresh start, together');
  await expect(page.getByLabel('Headline',{exact:true})).toHaveValue('A fresh start, together');
  await page.getByLabel('Button label',{exact:true}).fill('Explore your workspace');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Draft saved. SES has not changed.');
  await page.getByRole('button',{name:'Review saved changes',exact:true}).click();
  await expect(page.locator('#comparison')).toContainText('A fresh start, together');
  await expect(page.locator('#comparison')).toContainText('A good place to start');
  await page.getByRole('button',{name:'Close review',exact:true}).click();
  await page.reload(); await page.getByRole('button',{name:/Workspace welcome/}).click();
  await expect(page.getByLabel('Headline',{exact:true})).toHaveValue('A fresh start, together');
  await page.getByRole('button',{name:'Preview with sample',exact:true}).click();
  await expect(frame.locator('#greeting')).toHaveText('Hello Alex, welcome home.');
  await expect(frame.locator('#action')).toHaveAttribute('href','https://example.test/workspace?token=sample');
  await expect(frame.locator('#headline')).toHaveText('A fresh start, together');
  await page.getByRole('button',{name:'Plain text',exact:true}).click();
  await expect(page.locator('#plain')).toContainText('Explore your workspace: https://example.test/workspace?token=sample');
  await page.getByRole('button',{name:'Publish changes',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('house-copy-welcome');
  await page.getByRole('dialog').getByRole('button',{name:'Publish changes',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Changes published. The prior revision is in history.');
  await page.getByText('Revision history',{exact:true}).click();
  await page.getByRole('button',{name:'View publication',exact:true}).click();
  await expect(page.locator('#comparison')).toContainText('A fresh start, together');
  await page.getByRole('button',{name:'Close review',exact:true}).click();
  await page.getByRole('button',{name:'Restore this revision',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Restore revision',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Prior revision restored.');
  await expect(page.getByLabel('Headline',{exact:true})).toHaveValue('A good place to start');
  expect(errors).toEqual([]);
});

test('UI rejects variable corruption and displays protected templates',async({page})=>{
  page.on('dialog',dialog=>dialog.accept());
  await page.goto('/'); await page.getByRole('button',{name:/Workspace welcome/}).click();
  await page.getByLabel('Greeting',{exact:true}).fill('Hello friend');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Keep all template variables');
  await expect(page.getByRole('button',{name:'Publish changes',exact:true})).toBeDisabled();
  await page.reload(); await page.getByRole('button',{name:/Order receipt/}).click();
  await expect(page.locator('#notice')).toContainText('This template is protected');
  await expect(page.getByRole('button',{name:'Save draft',exact:true})).toBeDisabled();
});

test('sample HTML cannot execute scripts, navigate or request external resources',async({page})=>{
  const responses=[]; const failures=[]; const dialogs=[];
  page.on('response',response=>{if(response.url().startsWith('https://example.test')) responses.push(response.url());});
  page.on('requestfailed',request=>{if(request.url().startsWith('https://example.test')) failures.push(request.failure()?.errorText);});
  page.on('dialog',dialog=>{dialogs.push(dialog.message());dialog.dismiss();});
  await page.goto('/'); await page.getByRole('button',{name:/Workspace welcome/}).click();
  await page.getByText('Sample recipient',{exact:true}).click();
  await page.getByLabel('person › firstName',{exact:true}).fill('<img src="https://example.test/tracker" onerror="alert(1)"><script>alert(2)</script><a href="https://example.test/leak">Sneaky link</a>');
  await page.getByRole('button',{name:'Preview with sample',exact:true}).click();
  const frame=page.frameLocator('#email');
  await expect(frame.locator('#headline')).toHaveText('A good place to start');
  await frame.locator('#greeting a').click();
  await expect(page).toHaveURL(/\/$/);
  expect(responses).toEqual([]); expect(dialogs).toEqual([]);
  expect(failures).toHaveLength(1); expect(failures[0]).toMatch(/csp|blocked/i);
  expect(await frame.locator('.card').evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(255, 255, 255)');
});
