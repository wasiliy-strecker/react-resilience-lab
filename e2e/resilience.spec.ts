import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

import { e2eApiOrigin, e2eResetToken } from './test-environment.js'

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${e2eApiOrigin}/__test/reset`, {
    headers: { 'x-test-reset-token': e2eResetToken },
  })

  expect(response.status()).toBe(204)
})

test('persists an optimistic command across an API outage and reload', async ({
  page,
}) => {
  await openConsole(page)
  const details = incidentDetails(page)

  await page.route('**/api/**', (route) => route.abort('internetdisconnected'))
  await details.getByRole('button', { name: 'Acknowledge' }).click()

  await expect(details.getByText('acknowledged', { exact: true })).toBeVisible()
  await expect(details.getByText('Version 4', { exact: true })).toBeVisible()
  await expect(outboxCount(page)).toHaveText('1')

  await page.reload()

  await expect(
    page.getByText('Refresh failed. Showing the last successful snapshot.'),
  ).toBeVisible()
  await expect(
    incidentDetails(page).getByText('acknowledged', { exact: true }),
  ).toBeVisible()
  await expect(
    incidentDetails(page).getByText('Version 4', { exact: true }),
  ).toBeVisible()
  await expect(outboxCount(page)).toHaveText('1')

  await page.unroute('**/api/**')
  await page.evaluate(() => globalThis.dispatchEvent(new Event('online')))

  await expect(outboxCount(page)).toHaveText('0')
  await page.reload()
  await expect(
    incidentDetails(page).getByText('acknowledged', { exact: true }),
  ).toBeVisible()
  await expect(
    incidentDetails(page).getByText('Version 4', { exact: true }),
  ).toBeVisible()
})

test('isolates a version conflict and requires an explicit recovery choice', async ({
  page,
}) => {
  await openConsole(page)
  await page.getByRole('radio', { name: /^Conflict/ }).check()
  await incidentDetails(page)
    .getByRole('button', { name: 'Acknowledge' })
    .click()

  const recovery = page.getByRole('alert', {
    name: 'Command needs a decision',
  })
  await expect(recovery).toBeVisible()
  await expect(recovery).toBeFocused()
  await expect(
    incidentDetails(page).getByText('Version 4', { exact: true }),
  ).toBeVisible()
  await expect(
    incidentDetails(page).getByText('External operator'),
  ).toBeVisible()
  await expect(outboxCount(page)).toHaveText('1')

  await page.getByRole('radio', { name: /^Normal/ }).check()
  await recovery.getByRole('button', { name: 'Retry on version 4' }).click()

  await expect(recovery).toBeHidden()
  await expect(
    incidentDetails(page).getByText('acknowledged', { exact: true }),
  ).toBeVisible()
  await expect(
    incidentDetails(page).getByText('Version 5', { exact: true }),
  ).toBeVisible()
  await expect(outboxCount(page)).toHaveText('0')
})

test('has no automatically detectable accessibility violations', async ({
  page,
}) => {
  await openConsole(page)

  const results = await new AxeBuilder({ page }).analyze()

  expect(results.violations).toEqual([])
})

async function openConsole(page: Page): Promise<void> {
  await page.goto('/')
  await expect(
    page.getByRole('button', { name: /Checkout latency above threshold/ }),
  ).toBeVisible()
  await expect(incidentDetails(page)).toBeVisible()
}

function incidentDetails(page: Page) {
  return page.getByLabel('Checkout latency above threshold details')
}

function outboxCount(page: Page) {
  return page.getByLabel('Command outbox status').locator(':scope > strong')
}
