import { parsePhoneNumberFromString } from 'libphonenumber-js'

export default function FormattedPhone({ value }: { value: string }) {
  return <>{parsePhoneNumberFromString(value)?.formatInternational() || value}</>
}
