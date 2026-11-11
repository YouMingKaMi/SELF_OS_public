import Foundation

// Exact rational accumulator used only at financial aggregation boundaries. Decimal division
// cannot represent thirds: 1/3 + 1/6 lands below 0.5. Integer limbs preserve that half-cent.
// Denominators use their least common multiple; no per-day rounding or floating point occurs.
struct FinanceFraction {
  private var numerator = FinanceInteger()
  private var denominator = FinanceNatural(1)
  mutating func add(_ minor: Decimal, days: Int = 1, divisor: Int = 1) {
    guard divisor > 0, days > 0 else { return }
    let d = UInt64(divisor)
    func gcd(_ a: UInt64, _ b: UInt64) -> UInt64 { b == 0 ? a : gcd(b, a % b) }
    let common = gcd(denominator.remainder(d), d)
    let scale = d / common
    let term = FinanceInteger(minor).multiplied(by: denominator.divided(by: common)).multiplied(
      by: UInt64(days))
    numerator = numerator.multiplied(by: scale).adding(term)
    denominator = denominator.multiplied(by: scale)
  }
  func rounded(dividingBy days: Int = 1) -> Decimal {
    guard days > 0 else { return 0 }
    let divisor = denominator.multiplied(by: UInt64(days))
    var (quotient, remainder) = numerator.magnitude.dividing(divisor)
    if remainder.multiplied(by: 2) >= divisor { quotient = quotient.adding(FinanceNatural(1)) }
    return Decimal(
      string: (numerator.negative && !quotient.isZero ? "-" : "") + quotient.description,
      locale: Locale(identifier: "en_US_POSIX")) ?? .nan
  }
}
private struct FinanceInteger {
  var magnitude = FinanceNatural(0)
  var negative = false
  init() {}
  init(_ decimal: Decimal) {
    let text = NSDecimalNumber(decimal: decimal).stringValue
    negative = text.hasPrefix("-")
    magnitude = FinanceNatural(String(text.dropFirst(negative ? 1 : 0)))
  }
  private init(_ magnitude: FinanceNatural, _ negative: Bool) {
    self.magnitude = magnitude
    self.negative = negative && !magnitude.isZero
  }
  func multiplied(by value: UInt64) -> Self { Self(magnitude.multiplied(by: value), negative) }
  func multiplied(by value: FinanceNatural) -> Self {
    Self(magnitude.multiplied(by: value), negative)
  }
  func adding(_ other: Self) -> Self {
    if negative == other.negative { return Self(magnitude.adding(other.magnitude), negative) }
    return magnitude >= other.magnitude
      ? Self(magnitude.subtracting(other.magnitude), negative)
      : Self(other.magnitude.subtracting(magnitude), other.negative)
  }
}
private struct FinanceNatural: Comparable, CustomStringConvertible {
  private static let base: UInt64 = 1_000_000_000
  private var limbs: [UInt64]
  var isZero: Bool { limbs == [0] }
  init(_ value: UInt64) {
    limbs = value < Self.base ? [value] : [value % Self.base, value / Self.base]
  }
  init(_ text: String) {
    var value = FinanceNatural(0)
    for char in text {
      if let digit = char.wholeNumberValue {
        value = value.multiplied(by: 10).adding(FinanceNatural(UInt64(digit)))
      }
    }
    self = value
  }
  private init(limbs: [UInt64]) {
    self.limbs = limbs
    while self.limbs.count > 1 && self.limbs.last == 0 { self.limbs.removeLast() }
  }
  var description: String {
    String(limbs.last ?? 0)
      + limbs.dropLast().reversed().map { String(format: "%09llu", $0) }.joined()
  }
  static func < (a: Self, b: Self) -> Bool {
    if a.limbs.count != b.limbs.count { return a.limbs.count < b.limbs.count }
    for (x, y) in zip(a.limbs.reversed(), b.limbs.reversed()) { if x != y { return x < y } }
    return false
  }
  func adding(_ other: Self) -> Self {
    var result: [UInt64] = []
    var carry: UInt64 = 0
    for i in 0..<max(limbs.count, other.limbs.count) {
      let value =
        (i < limbs.count ? limbs[i] : 0) + (i < other.limbs.count ? other.limbs[i] : 0) + carry
      result.append(value % Self.base)
      carry = value / Self.base
    }
    if carry > 0 { result.append(carry) }
    return Self(limbs: result)
  }
  func subtracting(_ other: Self) -> Self {
    precondition(self >= other)
    var result = limbs
    var borrow: UInt64 = 0
    for i in limbs.indices {
      let sub = (i < other.limbs.count ? other.limbs[i] : 0) + borrow
      if result[i] < sub {
        result[i] += Self.base
        borrow = 1
      } else {
        borrow = 0
      }
      result[i] -= sub
    }
    return Self(limbs: result)
  }
  func multiplied(by value: UInt64) -> Self {
    if value >= Self.base { return multiplied(by: Self(value)) }
    var result: [UInt64] = []
    var carry: UInt64 = 0
    for limb in limbs {
      let product = limb * value + carry
      result.append(product % Self.base)
      carry = product / Self.base
    }
    if carry > 0 { result.append(carry) }
    return Self(limbs: result)
  }
  func multiplied(by other: Self) -> Self {
    var result = [UInt64](repeating: 0, count: limbs.count + other.limbs.count)
    for i in limbs.indices {
      var carry: UInt64 = 0
      for j in other.limbs.indices {
        let value = result[i + j] + limbs[i] * other.limbs[j] + carry
        result[i + j] = value % Self.base
        carry = value / Self.base
      }
      result[i + other.limbs.count] = carry
    }
    return Self(limbs: result)
  }
  func remainder(_ divisor: UInt64) -> UInt64 {
    limbs.reversed().reduce(0) { ($0 * Self.base + $1) % divisor }
  }
  func divided(by divisor: UInt64) -> Self {
    var result = limbs
    var remainder: UInt64 = 0
    for i in limbs.indices.reversed() {
      let value = remainder * Self.base + limbs[i]
      result[i] = value / divisor
      remainder = value % divisor
    }
    return Self(limbs: result)
  }
  func dividing(_ divisor: Self) -> (Self, Self) {
    precondition(!divisor.isZero)
    var result = [UInt64](repeating: 0, count: limbs.count)
    var remainder = Self(0)
    for i in limbs.indices.reversed() {
      remainder = Self(limbs: [limbs[i]] + remainder.limbs)
      guard remainder >= divisor else { continue }
      var low: UInt64 = 1
      var high = Self.base - 1
      var digit: UInt64 = 0
      while low <= high {
        let middle = low + (high - low) / 2
        if divisor.multiplied(by: middle) <= remainder {
          digit = middle
          low = middle + 1
        } else {
          high = middle - 1
        }
      }
      result[i] = digit
      remainder = remainder.subtracting(divisor.multiplied(by: digit))
    }
    return (Self(limbs: result), remainder)
  }
}
