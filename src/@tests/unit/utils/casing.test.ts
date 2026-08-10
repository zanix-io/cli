import { assertEquals } from '@std/assert'
import { toKebabCase, toPascalCase } from 'utils/casing.ts'

Deno.test('toKebabCase normalizes camelCase, PascalCase, snake_case and spaced input', () => {
  assertEquals(toKebabCase('PaymentMethod'), 'payment-method')
  assertEquals(toKebabCase('paymentMethod'), 'payment-method')
  assertEquals(toKebabCase('payment_method'), 'payment-method')
  assertEquals(toKebabCase('  Payment Method  '), 'payment-method')
  assertEquals(toKebabCase('grant-access'), 'grant-access')
  assertEquals(toKebabCase('netting-opportunities'), 'netting-opportunities')
})

Deno.test('toPascalCase normalizes kebab-case, snake_case, spaced and camelCase input', () => {
  assertEquals(toPascalCase('payment-method'), 'PaymentMethod')
  assertEquals(toPascalCase('payment_method'), 'PaymentMethod')
  assertEquals(toPascalCase('  payment method  '), 'PaymentMethod')
  assertEquals(toPascalCase('paymentMethod'), 'PaymentMethod')
  assertEquals(toPascalCase('grant-access'), 'GrantAccess')
  assertEquals(toPascalCase('PAYMENT'), 'Payment')
})
