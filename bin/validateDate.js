
function validateYear(year) {

   // determine the current year
   const now = new Date();
   const currentYear = now.getFullYear();

   // determines the start year of the MEI validity
   const minYear = 2009;

   // check if the input year is a string containing only numbers
  if(!/^\d+$/.test(year)) return [false, 'Por favor, digite um número.'];

  // check if the year has 4 digits
  if(year.length !== 4) return [false, 'O ano precisa conter 4 dígitos.'];

  // check if the year is within the allowed range
  if(parseInt(year, 10) < minYear || parseInt(year, 10) > currentYear) return [false, `O ano deve estar entre 2009 e ${currentYear}.`];

  return [true];

}

function validateMonth(month) {
  const normalizedMonth = month.toString().trim();

  // check if the input month is a string containing only numbers
  if(!/^\d+$/.test(normalizedMonth)) return [false, 'Por favor, digite um número.'];

  // accepts both "8" and "08"
  if(normalizedMonth.length > 2) return [false, 'O mês precisa conter no máximo 2 dígitos.'];

  // check if the month is within the allowed range
  if(parseInt(normalizedMonth, 10) < 1 || parseInt(normalizedMonth, 10) > 12) return [false, 'O valor digitado não é um mês válido.'];

  return [true];



}

function createMonthRange(startMonth, endMonth) {
  const start = parseInt(startMonth, 10);
  const end = parseInt(endMonth, 10);

  return Array.from(
    { length: end - start + 1 },
    (_, index) => String(start + index).padStart(2, '0')
  );
}

export { validateYear, validateMonth, createMonthRange };
