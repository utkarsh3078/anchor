// The answer model used unless the visitor picks another under "Advanced": the server's
// default when this key can use it, otherwise the first flash model, otherwise whatever
// the key lists first.
export function pickDefaultModel({ models = [], defaultModel } = {}) {
  if (models.some((m) => m.id === defaultModel)) return defaultModel;
  return models.find((m) => m.id.includes('flash'))?.id ?? models[0]?.id ?? defaultModel;
}
