import { assertEquals, assertNotEquals } from '@std/assert'
import { generateZanixHash } from 'utils/config/base.ts'

Deno.test('generateZanixHash should return the correct hash for valid input', () => {
  // Example input
  const name = '@org/my-project'

  // Expected hash result based on the algorithm
  const expectedHash = 'omp473' // You should replace this with the actual expected result

  // Call the function with the test input
  const result = generateZanixHash(name)

  // Assert that the result matches the expected hash
  assertEquals(result, expectedHash)
})

Deno.test('generateZanixHash should handle names with no project name', () => {
  // Example input without project name
  const name = '@org'

  // Expected hash result for just the org name
  const expectedHash = 'oo392r' // You should replace this with the actual expected result

  // Call the function with the test input
  const result = generateZanixHash(name)

  // Assert that the result matches the expected hash
  assertEquals(result, expectedHash)
})

Deno.test('generateZanixHash should return different hashes for different inputs', () => {
  // Different inputs to ensure uniqueness
  const name1 = '@org/project-one'
  const name2 = '@org/project-two'

  // Generate hashes for both names
  const hash1 = generateZanixHash(name1)
  const hash2 = generateZanixHash(name2)

  // Assert that the hashes are different
  assertNotEquals(hash1, hash2)
})

Deno.test('generateZanixHash should correctly handle special characters in the name', () => {
  // Example input with special characters
  const name = '@org/my-project$#'

  // Expected hash result based on the algorithm
  const expectedHash = 'omp544' // You should replace this with the actual expected result

  // Call the function with the test input
  const result = generateZanixHash(name)

  // Assert that the result matches the expected hash
  assertEquals(result, expectedHash)
})
