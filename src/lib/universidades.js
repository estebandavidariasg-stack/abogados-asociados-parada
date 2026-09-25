// Fuente única de las universidades que se ofrecen en los selectores del
// sistema. La usan el registro del profesional (RegisterModal) y los dos
// perfiles (ProfilePage / ProfileContadorPage), para que la lista no se
// desincronice entre el alta y la edición posterior.
//
// 'Otra' es el centinela que activa el input de texto libre: NO se guarda
// ese literal en profiles.universidad, sino lo que el usuario escriba.
export const UNIVERSIDADES = [
  'Universidad Nacional de Colombia',
  'Universidad de los Andes',
  'Universidad de Antioquia',
  'Universidad Javeriana',
  'Universidad del Rosario',
  'Universidad Externado de Colombia',
  'Universidad Libre',
  'Universidad de La Sabana',
  'Universidad EAFIT',
  'Universidad del Norte',
  'Universidad Industrial de Santander',
  'Universidad de Cartagena',
  'Universidad de Nariño',
  'Universidad del Cauca',
  'Universidad Surcolombiana',
  'Universidad de Córdoba',
  'Universidad Popular del Cesar',
  'Universidad de La Guajira',
  'Universidad Francisco de Paula Santander',
  'Universidad de Pamplona',
  'Universidad Autónoma de Bucaramanga',
  'Universidad Cooperativa de Colombia',
  'Universidad Santo Tomás',
  'Universidad Militar Nueva Granada',
  'Universidad Distrital Francisco José de Caldas',
  'Universidad Pedagógica Nacional',
  'Universidad de Caldas',
  'Universidad de Manizales',
  'Universidad del Quindío',
  'Universidad Tecnológica de Pereira',
  'Universidad del Valle',
  'Universidad Santiago de Cali',
  'Universidad Autónoma de Occidente',
  'Universidad de San Buenaventura',
  'Universidad Piloto de Colombia',
  'Otra',
]
