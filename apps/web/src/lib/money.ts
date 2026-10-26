export function formatMinor(amountMinor: string): {
  text: string;
  accessible: string;
} {
  if (!/^(0|[1-9]\d*|-[1-9]\d*)$/.test(amountMinor)) {
    throw new Error(
      'MoneyDisplay requires a canonical integer minor-unit string',
    );
  }

  const amount = BigInt(amountMinor);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  const grouped = new Intl.NumberFormat('en-NG').format(whole);

  return {
    text: `${negative ? '−' : ''}₦${grouped}.${fraction}`,
    accessible: `${negative ? 'negative ' : ''}${grouped} naira and ${fraction} kobo`,
  };
}
