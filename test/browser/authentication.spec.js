import { test,expect } from '@playwright/test';
import { Store } from '../../src/store.js';
import { FakeSes } from '../../src/adapters.js';
import { TemplateService } from '../../src/service.js';
import { secureApp } from '../support/secure-app.js';
import { fixtures,config } from '../helpers.js';
test.use({ignoreHTTPSErrors:true});
let f,store,service;
test.beforeEach(async()=>{
  store=new Store(':memory:');
  service=new TemplateService(store,new FakeSes(store,fixtures),structuredClone(config));
  f=await secureApp({store,service});
});
test.afterEach(async()=>{if(f) await f.close();store?.close();});
async function signIn(page,context) {
  const popupPromise=context.waitForEvent('page');
  await page.getByRole('link',{name:'Sign in in a new tab'}).click();
  const popup=await popupPromise;
  await expect(popup.locator('#account-name')).toContainText(f.policy.users.find(u=>u.subject===f.provider.settings.subject).label);
  await page.getByRole('button',{name:'Resume after sign-in'}).click();
  await expect(page.locator('#session-notice')).toBeHidden();
  await popup.close();
}
test('individual publisher signs in, publishes and restores with attribution, then signs out',async({page,context})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(f.origin);
  await expect(page.locator('#library')).toBeHidden();
  await signIn(page,context);
  await page.getByRole('button',{name:/Workspace welcome/}).click();
  await page.getByLabel('Headline',{exact:true}).fill('Published by Jordan');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await page.getByRole('button',{name:'Preview with sample',exact:true}).click();
  await page.getByRole('button',{name:'Publish changes',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Publish changes',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Changes published. The prior revision is in history.');
  await page.getByText('Revision history',{exact:true}).click();
  await expect(page.locator('.revision').first()).toContainText('publisher');
  await page.getByRole('button',{name:'Restore this revision',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Restore revision',exact:true}).click();
  await expect(page.getByLabel('Headline',{exact:true})).toHaveValue('A good place to start');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Signed out of House Copy.');
  expect((await context.request.get(`${f.origin}/auth/session`)).status()).toBe(401);
  expect(errors).toEqual([]);
});
test('editor can save and preview, sees publishing restriction, and cannot bypass it through the API',async({page,context})=>{
  f.provider.settings.subject='editor';f.provider.settings.amr=[];
  await page.goto(f.origin);await signIn(page,context);
  await page.getByRole('button',{name:/Workspace welcome/}).click();
  await page.getByLabel('Headline',{exact:true}).fill('Editor prepared this draft');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await page.getByRole('button',{name:'Preview with sample',exact:true}).click();
  await expect(page.getByRole('button',{name:'Publish changes',exact:true})).toBeDisabled();
  await expect(page.locator('#publish-help')).toContainText('A publisher must publish or restore');
  const session=await (await context.request.get(`${f.origin}/auth/session`)).json();
  const response=await context.request.post(`${f.origin}/api/templates/house-copy-welcome/publish`,{headers:{Origin:f.origin,'X-House-Copy':'1','X-CSRF-Token':session.csrfToken,'X-Role':'publisher'},data:{}});
  expect(response.status()).toBe(403);
});
test('expired session preserves unsaved content and resumes after signing in in another tab',async({page,context})=>{
  await page.goto(f.origin);await signIn(page,context);
  await page.getByRole('button',{name:/Workspace welcome/}).click();
  await page.getByLabel('Headline',{exact:true}).fill('Keep my unsaved work');
  f.advance(15*60*1000);
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.locator('#session-notice')).toBeVisible();
  await expect(page.getByLabel('Headline',{exact:true})).toHaveValue('Keep my unsaved work');
  await signIn(page,context);
  await expect(page.getByLabel('Headline',{exact:true})).toHaveValue('Keep my unsaved work');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Draft saved. SES has not changed.');
});


test('two independent signed-in publishers review, publish and restore the exact approved changes',async({page,context,browser})=>{
  service.config.publicationPolicy={requireApproval:true,requireTicket:true};
  f.policy.users.push({subject:'reviewer',label:'Independent reviewer',role:'publisher'});
  await page.goto(f.origin);await signIn(page,context);
  await page.getByRole('button',{name:/Workspace welcome/}).click();
  await page.getByLabel('Headline',{exact:true}).fill('Independently approved copy');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await page.getByLabel('Change reason',{exact:true}).fill('Clarify the first welcome');
  await page.getByLabel('Ticket or reference',{exact:true}).fill('CHANGE-200');
  await page.getByRole('button',{name:'Request independent review',exact:true}).click();
  await expect(page.getByRole('button',{name:'Approve this change',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Close review',exact:true}).click();
  const reviewerContext=await browser.newContext({ignoreHTTPSErrors:true});
  try {
    f.provider.settings.subject='reviewer';const reviewer=await reviewerContext.newPage();
    await reviewer.goto(f.origin);await signIn(reviewer,reviewerContext);
    await reviewer.getByRole('button',{name:/Workspace welcome/}).click();
    await reviewer.getByText('Change reviews',{exact:true}).click();
    await reviewer.getByRole('button',{name:'Review this change',exact:true}).click();
    await expect(reviewer.locator('#comparison')).toContainText('Clarify the first welcome');
    await expect(reviewer.frameLocator('#review-previews iframe').last().locator('#headline')).toHaveText('Independently approved copy');
    await reviewer.getByRole('button',{name:'Approve this change',exact:true}).click();
    await reviewer.getByRole('button',{name:'Publish approved change',exact:true}).click();
    await reviewer.locator('#confirmation').getByRole('button',{name:'Publish approved change',exact:true}).click();
    await expect(reviewer.getByRole('status')).toHaveText('Approved change published.');
    await reviewer.getByLabel('Change reason',{exact:true}).fill('Restore the previous welcome');
    await reviewer.getByLabel('Ticket or reference',{exact:true}).fill('CHANGE-201');
    await reviewer.getByText('Revision history',{exact:true}).click();
    await reviewer.getByRole('button',{name:'Request restore review',exact:true}).click();
    await expect(reviewer.getByRole('button',{name:'Approve this change',exact:true})).toBeDisabled();
    await page.reload();await page.getByRole('button',{name:/Workspace welcome/}).click();
    await page.getByText('Change reviews',{exact:true}).click();
    await page.getByRole('button',{name:'Review this change',exact:true}).first().click();
    await page.getByRole('button',{name:'Approve this change',exact:true}).click();
    await page.getByRole('button',{name:'Restore approved revision',exact:true}).click();
    await page.locator('#confirmation').getByRole('button',{name:'Restore approved revision',exact:true}).click();
    await expect(page.getByRole('status')).toHaveText('Approved revision restored.');
    await expect(page.getByLabel('Headline',{exact:true})).toHaveValue('A good place to start');
  } finally {await reviewerContext.close();}
});
