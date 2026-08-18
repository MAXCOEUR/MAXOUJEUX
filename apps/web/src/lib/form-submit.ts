interface ResettableForm {
  reset: () => void;
}

/**
 * Conserve une référence stable au formulaire pendant une mutation asynchrone.
 * `event.currentTarget` n'est plus fiable après un `await` React.
 */
export async function resetAfterSuccessfulSubmit<T>(
  form: ResettableForm,
  submit: () => Promise<T>,
): Promise<T> {
  const result = await submit();
  form.reset();
  return result;
}
