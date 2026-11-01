import PhoneInput from 'react-phone-number-input'
import flags from 'react-phone-number-input/flags'
import 'react-phone-number-input/style.css'

export default function PhoneNumberInput({ value, onChange }: {
  value: string
  onChange: (value: string) => void
}) {
  return <PhoneInput
    id="profile-phone"
    required
    defaultCountry="PH"
    international
    countryCallingCodeEditable={false}
    limitMaxLength
    addInternationalOption={false}
    flags={flags}
    value={value || undefined}
    onChange={next => onChange(next ?? '')}
    autoComplete="tel"
    placeholder="Enter phone number"
    countrySelectProps={{ 'aria-label': 'Phone country' }}
    className="phone-field min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
  />
}
