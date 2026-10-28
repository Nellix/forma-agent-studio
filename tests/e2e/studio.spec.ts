import {test,expect} from '@playwright/test';
test('create, refine, test, publish, and reopen an agent',async({page})=>{
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Make room for what matters.'})).toBeVisible();
 await page.getByRole('button',{name:'New agent',exact:true}).click();
 await expect(page.getByLabel('Agent name')).toBeVisible();
 await page.getByLabel('Agent name').fill('Browser test agent');
 await page.getByRole('button',{name:'Group the summary by sender',exact:true}).click();
 await expect(page.getByText('Grouped by sender',{exact:true})).toBeVisible({timeout:20000});
 await page.getByRole('button',{name:'Run test',exact:true}).click();
 await expect(page.getByText('Execution completed',{exact:true})).toBeVisible({timeout:20000});
 await expect(page.getByText('By sender',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Publish',exact:true}).click();
 await expect(page.getByText('Draft · published v1',{exact:true})).toBeVisible();
 await page.reload();
 await expect(page.getByLabel('Agent name')).toHaveValue('Browser test agent');
 await expect(page.getByText('Execution completed',{exact:true})).toBeVisible();
});
test('execute and publish the native digest workflow',async({page})=>{
 await page.goto('/#/workflows/inbox-digest');
 await expect(page.getByLabel('Workflow name')).toHaveValue('Inbox Digest');
 await page.getByRole('button',{name:'Run workflow',exact:true}).click();
 await page.getByRole('button',{name:'Start execution',exact:true}).click();
 await expect(page.getByText('Execution completed',{exact:true})).toBeVisible({timeout:20000});
 await expect(page.getByText('Your priority briefing',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Publish',exact:true}).click();
 await expect(page.getByText(/Workflow version \d+ published\./)).toBeVisible();
});
test('Apps is a labeled mockup and the mobile homepage remains usable',async({page})=>{
 await page.goto('/#/apps');
 await expect(page.getByText('Preview only',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Publish app',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Use a dark theme',exact:true}).click();
 await expect(page.locator('.mock-app')).toHaveClass(/mock-dark/);
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 await expect(page.getByRole('button',{name:'Build agent',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
