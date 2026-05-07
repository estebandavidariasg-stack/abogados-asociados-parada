// División político-administrativa de Colombia (DANE).
// Cada departamento expone su capital y su set de municipios.
// Para 11 ciudades principales se incluyen barrios/comunas representativos
// (mínimo 8). El resto de municipios tiene array vacío y oculta el nivel 3.
// Bogotá D.C. usa `localidades` en lugar de `municipios`.

// Helper para no repetir municipios que no tienen barrios listados.
const m = (...nombres) => nombres.reduce((acc, n) => { acc[n] = []; return acc }, {})

export const UBICACIONES = {

  "Amazonas": {
    capital: "Leticia",
    municipios: {
      "Leticia": ["Centro","Victoria Regia","La Esperanza","Once de Noviembre","San Martín","San Antonio","La Sarita","Porvenir","Castañal","José María Hernández"],
      ...m("Puerto Nariño","El Encanto","La Chorrera","La Pedrera","La Victoria","Mirití-Paraná","Puerto Alegría","Puerto Arica","Puerto Santander","Tarapacá")
    }
  },

  "Antioquia": {
    capital: "Medellín",
    municipios: {
      "Medellín": ["Popular","Santa Cruz","Manrique","Aranjuez","Castilla","Doce de Octubre","Robledo","Villa Hermosa","Buenos Aires","La Candelaria","Laureles-Estadio","La América","San Javier","El Poblado","Guayabal","Belén"],
      ...m("Abejorral","Abriaquí","Alejandría","Amagá","Amalfi","Andes","Angelópolis","Angostura","Anorí","Anzá","Apartadó","Arboletes","Argelia","Armenia","Barbosa","Bello","Belmira","Betania","Betulia","Briceño","Buriticá","Cáceres","Caicedo","Caldas","Campamento","Cañasgordas","Caracolí","Caramanta","Carepa","Carolina del Príncipe","Caucasia","Chigorodó","Cisneros","Ciudad Bolívar","Cocorná","Concepción","Concordia","Copacabana","Dabeiba","Don Matías","Ebéjico","El Bagre","El Carmen de Viboral","El Peñol","El Retiro","El Santuario","Entrerríos","Envigado","Fredonia","Frontino","Giraldo","Girardota","Gómez Plata","Granada","Guadalupe","Guarne","Guatapé","Heliconia","Hispania","Itagüí","Ituango","Jardín","Jericó","La Ceja","La Estrella","La Pintada","La Unión","Liborina","Maceo","Marinilla","Montebello","Murindó","Mutatá","Nariño","Necoclí","Nechí","Olaya","Peque","Pueblorrico","Puerto Berrío","Puerto Nare","Puerto Triunfo","Remedios","Rionegro","Sabanalarga","Sabaneta","Salgar","San Andrés de Cuerquia","San Carlos","San Francisco","San Jerónimo","San José de la Montaña","San Juan de Urabá","San Luis","San Pedro de los Milagros","San Pedro de Urabá","San Rafael","San Roque","San Vicente Ferrer","Santa Bárbara","Santa Fe de Antioquia","Santa Rosa de Osos","Santo Domingo","Segovia","Sonsón","Sopetrán","Támesis","Tarazá","Tarso","Titiribí","Toledo","Turbo","Uramita","Urrao","Valdivia","Valparaíso","Vegachí","Venecia","Vigía del Fuerte","Yalí","Yarumal","Yolombó","Yondó","Zaragoza")
    }
  },

  "Arauca": {
    capital: "Arauca",
    municipios: {
      "Arauca": ["Centro","La Esperanza","La Granja","Brisas del Llano","Córdoba","Las Acacias","Olímpico","La Floresta","Cristo Rey","San Luis"],
      ...m("Arauquita","Cravo Norte","Fortul","Puerto Rondón","Saravena","Tame")
    }
  },

  "Atlántico": {
    capital: "Barranquilla",
    municipios: {
      "Barranquilla": ["Centro","El Prado","Alto Prado","Riomar","Boston","Villa Country","Crespo","El Golf","La Concepción","Granadillo","San Vicente","Las Mercedes","Las Nieves","La Cumbre","La Concepción"],
      ...m("Baranoa","Campo de la Cruz","Candelaria","Galapa","Juan de Acosta","Luruaco","Malambo","Manatí","Palmar de Varela","Piojó","Polonuevo","Ponedera","Puerto Colombia","Repelón","Sabanagrande","Sabanalarga","Santa Lucía","Santo Tomás","Soledad","Suan","Tubará","Usiacurí")
    }
  },

  "Bolívar": {
    capital: "Cartagena de Indias",
    municipios: {
      "Cartagena de Indias": ["Centro Histórico","Getsemaní","San Diego","Bocagrande","Castillogrande","Manga","El Laguito","La Boquilla","Crespo","Marbella","Pie de la Popa","El Cabrero","Torices","Bosque","Manzanillo del Mar"],
      ...m("Achí","Altos del Rosario","Arenal","Arjona","Arroyohondo","Barranco de Loba","Calamar","Cantagallo","Cicuco","Clemencia","Córdoba","El Carmen de Bolívar","El Guamo","El Peñón","Hatillo de Loba","Magangué","Mahates","Margarita","María la Baja","Mompós","Montecristo","Morales","Norosí","Pinillos","Regidor","Río Viejo","San Cristóbal","San Estanislao","San Fernando","San Jacinto","San Jacinto del Cauca","San Juan Nepomuceno","San Martín de Loba","San Pablo","Santa Catalina","Santa Rosa","Santa Rosa del Sur","Simití","Soplaviento","Talaigua Nuevo","Tiquisio","Turbaco","Turbaná","Villanueva","Zambrano")
    }
  },

  "Boyacá": {
    capital: "Tunja",
    municipios: {
      "Tunja": ["Centro","Las Quintas","La Cabaña","Patriotas","Suárez","Los Muiscas","Maldonado","San Antonio","La Granja","Asís"],
      ...m("Almeida","Aquitania","Arcabuco","Belén","Berbeo","Betéitiva","Boavita","Boyacá","Briceño","Buenavista","Busbanzá","Caldas","Campohermoso","Cerinza","Chinavita","Chiquinquirá","Chíquiza","Chiscas","Chita","Chitaraque","Chivatá","Chivor","Cómbita","Coper","Corrales","Covarachía","Cubará","Cucaita","Cuítiva","Duitama","El Cocuy","El Espino","Firavitoba","Floresta","Gachantivá","Gámeza","Garagoa","Guacamayas","Guateque","Guayatá","Güicán de la Sierra","Iza","Jenesano","Jericó","La Capilla","La Uvita","La Victoria","Labranzagrande","Macanal","Maripí","Miraflores","Mongua","Monguí","Moniquirá","Motavita","Muzo","Nobsa","Nuevo Colón","Oicatá","Otanche","Pachavita","Páez","Paipa","Pajarito","Panqueba","Pauna","Paya","Paz de Río","Pesca","Pisba","Puerto Boyacá","Quípama","Ramiriquí","Ráquira","Rondón","Saboyá","Sáchica","Samacá","San Eduardo","San José de Pare","San Luis de Gaceno","San Mateo","San Miguel de Sema","San Pablo de Borbur","Santa María","Santa Rosa de Viterbo","Santa Sofía","Santana","Sativanorte","Sativasur","Siachoque","Soatá","Socha","Socotá","Sogamoso","Somondoco","Sora","Soracá","Sotaquirá","Susacón","Sutamarchán","Sutatenza","Tasco","Tenza","Tibaná","Tibasosa","Tinjacá","Tipacoque","Toca","Togüí","Tópaga","Tota","Tununguá","Turmequé","Tuta","Tutazá","Umbita","Ventaquemada","Villa de Leyva","Viracachá","Zetaquira")
    }
  },

  "Caldas": {
    capital: "Manizales",
    municipios: {
      "Manizales": ["Atardeceres","San José","Cumanday","La Estación","Ciudadela del Norte","Ecoturístico Cerro de Oro","La Macarena","La Fuente","Tesorito","Palogrande","Universitaria"],
      ...m("Aguadas","Anserma","Aranzazu","Belalcázar","Chinchiná","Filadelfia","La Dorada","La Merced","Manzanares","Marmato","Marquetalia","Marulanda","Neira","Norcasia","Pácora","Palestina","Pensilvania","Riosucio","Risaralda","Salamina","Samaná","San José","Supía","Victoria","Villamaría","Viterbo")
    }
  },

  "Caquetá": {
    capital: "Florencia",
    municipios: {
      "Florencia": ["Centro","Las Malvinas","La Estrella","Versalles","La Consolata","Juan XXIII","Buenos Aires","Yapurá","Capitolio","Ventilador"],
      ...m("Albania","Belén de los Andaquíes","Cartagena del Chairá","Curillo","El Doncello","El Paujil","La Montañita","Milán","Morelia","Puerto Rico","San José del Fragua","San Vicente del Caguán","Solano","Solita","Valparaíso")
    }
  },

  "Casanare": {
    capital: "Yopal",
    municipios: {
      "Yopal": ["Centro","La Esperanza","Bicentenario","Llano Lindo","Las Brisas","La Bendición","Camoruco","La Campiña","Provivienda","San Mateo"],
      ...m("Aguazul","Chámeza","Hato Corozal","La Salina","Maní","Monterrey","Nunchía","Orocué","Paz de Ariporo","Pore","Recetor","Sabanalarga","Sácama","San Luis de Palenque","Tauramena","Trinidad","Villanueva","Támara")
    }
  },

  "Cauca": {
    capital: "Popayán",
    municipios: {
      "Popayán": ["Centro Histórico","La Ladera","La Esmeralda","Cadillal","Modelo","El Recuerdo","La Estancia","La Paz","Santa Mónica","Bolívar","Versalles"],
      ...m("Almaguer","Argelia","Balboa","Bolívar","Buenos Aires","Cajibío","Caldono","Caloto","Corinto","El Tambo","Florencia","Guachené","Guapi","Inzá","Jambaló","La Sierra","La Vega","López de Micay","Mercaderes","Miranda","Morales","Padilla","Páez","Patía","Piamonte","Piendamó-Tunía","Puerto Tejada","Puracé","Rosas","San Sebastián","Santa Rosa","Santander de Quilichao","Silvia","Sotará","Suárez","Sucre","Timbío","Timbiquí","Toribío","Totoró","Villa Rica")
    }
  },

  "Cesar": {
    capital: "Valledupar",
    municipios: {
      "Valledupar": ["Centro","Novalito","Garupal","Loperena","Las Flores","La Esperanza","Los Mayales","San Joaquín","Villa Castro","Don Alberto","La Nevada"],
      ...m("Aguachica","Agustín Codazzi","Astrea","Becerril","Bosconia","Chimichagua","Chiriguaná","Curumaní","El Copey","El Paso","Gamarra","González","La Gloria","La Jagua de Ibirico","La Paz","Manaure Balcón del Cesar","Pailitas","Pelaya","Pueblo Bello","Río de Oro","San Alberto","San Diego","San Martín","Tamalameque")
    }
  },

  "Chocó": {
    capital: "Quibdó",
    municipios: {
      "Quibdó": ["Centro","Cristo Rey","La Aurora","La Esmeralda","Niño Jesús","Reposo","Yesquita","Pandeyuca","Roma","La Victoria"],
      ...m("Acandí","Alto Baudó","Atrato","Bagadó","Bahía Solano","Bajo Baudó","Bojayá","Cantón de San Pablo","Carmen del Darién","Cértegui","Condoto","El Carmen de Atrato","El Litoral del San Juan","Istmina","Juradó","Lloró","Medio Atrato","Medio Baudó","Medio San Juan","Nóvita","Nuquí","Río Iró","Río Quito","Riosucio","San José del Palmar","Sipí","Tadó","Unguía","Unión Panamericana")
    }
  },

  "Córdoba": {
    capital: "Montería",
    municipios: {
      "Montería": ["Centro","La Castellana","Los Ángeles","La Pradera","El Recreo","La Granja","P-5","Mocarí","Las Acacias","Boston","Sucre"],
      ...m("Ayapel","Buenavista","Canalete","Cereté","Chimá","Chinú","Ciénaga de Oro","Cotorra","La Apartada","Lorica","Los Córdobas","Momil","Montelíbano","Moñitos","Planeta Rica","Pueblo Nuevo","Puerto Escondido","Puerto Libertador","Purísima","Sahagún","San Andrés de Sotavento","San Antero","San Bernardo del Viento","San Carlos","San José de Uré","San Pelayo","Tierralta","Tuchín","Valencia")
    }
  },

  "Cundinamarca": {
    capital: "Bogotá D.C.",
    municipios: {
      ...m("Agua de Dios","Albán","Anapoima","Anolaima","Apulo","Arbeláez","Beltrán","Bituima","Bojacá","Cabrera","Cachipay","Cajicá","Caparrapí","Cáqueza","Carmen de Carupa","Chaguaní","Chía","Chipaque","Choachí","Chocontá","Cogua","Cota","Cucunubá","El Colegio","El Peñón","El Rosal","Facatativá","Fómeque","Fosca","Funza","Fúquene","Fusagasugá","Gachalá","Gachancipá","Gachetá","Gama","Girardot","Granada","Guachetá","Guaduas","Guasca","Guataquí","Guatavita","Guayabal de Síquima","Guayabetal","Gutiérrez","Jerusalén","Junín","La Calera","La Mesa","La Palma","La Peña","La Vega","Lenguazaque","Macheta","Madrid","Manta","Medina","Mosquera","Nariño","Nemocón","Nilo","Nimaima","Nocaima","Pacho","Paime","Pandi","Paratebueno","Pasca","Puerto Salgar","Pulí","Quebradanegra","Quetame","Quipile","Ricaurte","San Antonio del Tequendama","San Bernardo","San Cayetano","San Francisco","San Juan de Rioseco","Sasaima","Sesquilé","Sibaté","Silvania","Simijaca","Soacha","Sopó","Subachoque","Suesca","Supatá","Susa","Sutatausa","Tabio","Tausa","Tena","Tenjo","Tibacuy","Tibirita","Tocaima","Tocancipá","Topaipí","Ubalá","Ubaque","Ubaté","Une","Útica","Vergara","Vianí","Villagómez","Villapinzón","Villeta","Viotá","Yacopí","Zipacón","Zipaquirá")
    }
  },

  "Bogotá D.C.": {
    capital: "Bogotá D.C.",
    esBogota: true,
    localidades: ["Antonio Nariño","Barrios Unidos","Bosa","Chapinero","Ciudad Bolívar","Engativá","Fontibón","Kennedy","La Candelaria","Los Mártires","Puente Aranda","Rafael Uribe Uribe","San Cristóbal","Santa Fe","Suba","Sumapaz","Teusaquillo","Tunjuelito","Usaquén","Usme"]
  },

  "Guainía": {
    capital: "Inírida",
    municipios: {
      "Inírida": ["Centro","La Esperanza","Brisas del Inírida","Comuneros","Primavera","Berlín","Las Flores","La Vorágine","Las Brisas","El Porvenir"],
      ...m("Barranco Minas","Mapiripana","San Felipe","Puerto Colombia","La Guadalupe","Cacahual","Pana Pana","Morichal")
    }
  },

  "Guaviare": {
    capital: "San José del Guaviare",
    municipios: {
      "San José del Guaviare": ["Centro","La Esperanza","20 de Julio","Villa del Prado","Las Acacias","Brisas del Guaviare","La Granja","Porvenir","Modelo","Comuneros"],
      ...m("Calamar","El Retorno","Miraflores")
    }
  },

  "Huila": {
    capital: "Neiva",
    municipios: {
      "Neiva": ["Centro","Quirinal","Altico","Santa Inés","Las Granjas","La Toma","Limonar","Cándido","Calamarí","Las Palmas","Los Andes"],
      ...m("Acevedo","Agrado","Aipe","Algeciras","Altamira","Baraya","Campoalegre","Colombia","Elías","Garzón","Gigante","Guadalupe","Hobo","Íquira","Isnos","La Argentina","La Plata","Nátaga","Oporapa","Paicol","Palermo","Palestina","Pital","Pitalito","Rivera","Saladoblanco","San Agustín","Santa María","Suaza","Tarqui","Tello","Teruel","Tesalia","Timaná","Villavieja","Yaguará")
    }
  },

  "La Guajira": {
    capital: "Riohacha",
    municipios: {
      "Riohacha": ["Centro","Boca Grande","Coquivacoa","La Esperanza","Los Olivos","La Sierrita","Cooperativo","Almirante Padilla","Las Tunas","San Martín"],
      ...m("Albania","Barrancas","Dibulla","Distracción","El Molino","Fonseca","Hatonuevo","La Jagua del Pilar","Maicao","Manaure","San Juan del Cesar","Uribia","Urumita","Villanueva")
    }
  },

  "Magdalena": {
    capital: "Santa Marta",
    municipios: {
      "Santa Marta": ["Centro Histórico","El Rodadero","Bavaria","Gaira","Pescaíto","Mamatoco","Bonda","Taganga","Pozos Colorados","Bolívar","Manzanares","Los Trupillos"],
      ...m("Algarrobo","Aracataca","Ariguaní","Cerro San Antonio","Chivolo","Ciénaga","Concordia","El Banco","El Piñón","El Retén","Fundación","Guamal","Nueva Granada","Pedraza","Pijiño del Carmen","Pivijay","Plato","Pueblo Viejo","Remolino","Sabanas de San Ángel","Salamina","San Sebastián de Buenavista","San Zenón","Santa Ana","Santa Bárbara de Pinto","Sitionuevo","Tenerife","Zapayán","Zona Bananera")
    }
  },

  "Meta": {
    capital: "Villavicencio",
    municipios: {
      "Villavicencio": ["Centro","La Esperanza","Catatumbo","Bellavista","La Grama","La Madrid","La Vainilla","Brisas del Guatiquía","Macunaima","Maizaro","Camoa"],
      ...m("Acacías","Barranca de Upía","Cabuyaro","Castilla la Nueva","Cubarral","Cumaral","El Calvario","El Castillo","El Dorado","Fuente de Oro","Granada","Guamal","La Macarena","La Uribe","Lejanías","Mapiripán","Mesetas","Puerto Concordia","Puerto Gaitán","Puerto Lleras","Puerto López","Puerto Rico","Restrepo","San Carlos de Guaroa","San Juan de Arama","San Juanito","San Martín","Vista Hermosa")
    }
  },

  "Nariño": {
    capital: "Pasto",
    municipios: {
      "Pasto": ["Centro","San Andrés","Tamasagra","Anganoy","La Carolina","Las Cuadras","Pandiaco","Mijitayo","Las Lunas","La Aurora","Aranda"],
      ...m("Albán","Aldana","Ancuya","Arboleda","Barbacoas","Belén","Buesaco","Chachagüí","Colón","Consacá","Contadero","Córdoba","Cuaspud Carlosama","Cumbal","Cumbitara","El Charco","El Peñol","El Rosario","El Tablón de Gómez","El Tambo","Funes","Guachucal","Guaitarilla","Gualmatán","Iles","Imués","Ipiales","La Cruz","La Florida","La Llanada","La Tola","La Unión","Leiva","Linares","Los Andes","Magüí Payán","Mallama","Mosquera","Nariño","Olaya Herrera","Ospina","Policarpa","Potosí","Providencia","Puerres","Pupiales","Ricaurte","Roberto Payán","Samaniego","San Andrés de Tumaco","San Bernardo","San Lorenzo","San Pablo","San Pedro de Cartago","Sandoná","Santa Bárbara","Santacruz","Sapuyes","Taminango","Tangua","Túquerres","Yacuanquer")
    }
  },

  "Norte de Santander": {
    capital: "Cúcuta",
    municipios: {
      "Cúcuta": ["Centro","La Libertad","Aeropuerto","El Bosque","Pamplonita","Cundinamarca","Comuneros","Atalaya","Quinta Bosch","Caobos","Belén","Lomitas"],
      ...m("Ábrego","Arboledas","Bochalema","Bucarasica","Cácota","Cachirá","Chinácota","Chitagá","Convención","Cucutilla","Durania","El Carmen","El Tarra","El Zulia","Gramalote","Hacarí","Herrán","La Esperanza","La Playa","Labateca","Los Patios","Lourdes","Mutiscua","Ocaña","Pamplona","Pamplonita","Puerto Santander","Ragonvalia","Salazar","San Calixto","San Cayetano","Santiago","Sardinata","Silos","Teorama","Tibú","Toledo","Villa Caro","Villa del Rosario")
    }
  },

  "Putumayo": {
    capital: "Mocoa",
    municipios: {
      "Mocoa": ["Centro","Pueblo Viejo","Naranjito","Caliyaco","La Esmeralda","Líbano","Las Acacias","San Agustín","Veinte de Julio","Miraflores"],
      ...m("Colón","Orito","Puerto Asís","Puerto Caicedo","Puerto Guzmán","Puerto Leguízamo","San Francisco","San Miguel","Santiago","Sibundoy","Valle del Guamuez","Villagarzón")
    }
  },

  "Quindío": {
    capital: "Armenia",
    municipios: {
      "Armenia": ["Centro","Granada","Las Palmas","La Castellana","Los Naranjos","Salvador Allende","Cafetero","Mercedes del Norte","La Patria","La Cecilia","Brasilia"],
      ...m("Buenavista","Calarcá","Circasia","Córdoba","Filandia","Génova","La Tebaida","Montenegro","Pijao","Quimbaya","Salento")
    }
  },

  "Risaralda": {
    capital: "Pereira",
    municipios: {
      "Pereira": ["Centro","Pinares de San Martín","Álamos","El Jardín","Belmonte","Boston","Centenario","El Poblado","Cuba","Villa Olímpica","Ciudadela Cuba","Maraya"],
      ...m("Apía","Balboa","Belén de Umbría","Dosquebradas","Guática","La Celia","La Virginia","Marsella","Mistrató","Pueblo Rico","Quinchía","Santa Rosa de Cabal","Santuario")
    }
  },

  "San Andrés y Providencia": {
    capital: "San Andrés",
    municipios: {
      ...m("San Andrés","Providencia")
    }
  },

  "Santander": {
    capital: "Bucaramanga",
    municipios: {
      "Bucaramanga": ["Centro","Cabecera del Llano","Sotomayor","San Alonso","Real de Minas","García Rovira","Ciudadela Real","La Universidad","La Concordia","San Francisco","Cabecera","La Aurora"],
      ...m("Aguada","Albania","Aratoca","Barbosa","Barichara","Barrancabermeja","Betulia","Bolívar","Cabrera","California","Capitanejo","Carcasí","Cepitá","Cerrito","Charalá","Charta","Chima","Chipatá","Cimitarra","Concepción","Confines","Contratación","Coromoro","Curití","El Carmen de Chucurí","El Guacamayo","El Peñón","El Playón","Encino","Enciso","Florián","Floridablanca","Galán","Gámbita","Girón","Guaca","Guadalupe","Guapotá","Guavatá","Güepsa","Hato","Jesús María","Jordán","La Belleza","La Paz","Landázuri","Lebrija","Los Santos","Macaravita","Málaga","Matanza","Mogotes","Molagavita","Ocamonte","Oiba","Onzaga","Palmar","Palmas del Socorro","Páramo","Piedecuesta","Pinchote","Puente Nacional","Puerto Parra","Puerto Wilches","Rionegro","Sabana de Torres","San Andrés","San Benito","San Gil","San Joaquín","San José de Miranda","San Miguel","San Vicente de Chucurí","Santa Bárbara","Santa Helena del Opón","Simacota","Socorro","Suaita","Sucre","Suratá","Tona","Valle de San José","Vélez","Vetas","Villanueva","Zapatoca")
    }
  },

  "Sucre": {
    capital: "Sincelejo",
    municipios: {
      "Sincelejo": ["Centro","La Pollita","La María","San Carlos","Bosques de la Pradera","Las Margaritas","Botero","Las Flores","Mochila","La Esperanza"],
      ...m("Buenavista","Caimito","Chalán","Coloso","Corozal","Coveñas","El Roble","Galeras","Guaranda","La Unión","Los Palmitos","Majagual","Morroa","Ovejas","Palmito","Sampués","San Benito Abad","San Juan de Betulia","San Marcos","San Onofre","San Pedro","Santiago de Tolú","Sincé","Sucre","Tolú Viejo")
    }
  },

  "Tolima": {
    capital: "Ibagué",
    municipios: {
      "Ibagué": ["Centro","La Pola","Belén","Calambeo","La Macarena","Versalles","Ricaurte","Topacio","El Salado","Picaleña","Jordán","Cádiz","Ambalá"],
      ...m("Alpujarra","Alvarado","Ambalema","Anzoátegui","Armero","Ataco","Cajamarca","Carmen de Apicalá","Casabianca","Chaparral","Coello","Coyaima","Cunday","Dolores","Espinal","Falan","Flandes","Fresno","Guamo","Herveo","Honda","Icononzo","Lérida","Líbano","Mariquita","Melgar","Murillo","Natagaima","Ortega","Palocabildo","Piedras","Planadas","Prado","Purificación","Rioblanco","Roncesvalles","Rovira","Saldaña","San Antonio","San Luis","Santa Isabel","Suárez","Valle de San Juan","Venadillo","Villahermosa","Villarrica")
    }
  },

  "Valle del Cauca": {
    capital: "Cali",
    municipios: {
      "Cali": ["Granada","San Antonio","El Peñón","Ciudad Jardín","Pance","El Limonar","El Caney","San Fernando","El Lido","Versalles","Tequendama","Ciudad Capri","Aguablanca","Los Cristales","Santa Rita","Centro"],
      ...m("Alcalá","Andalucía","Ansermanuevo","Argelia","Bolívar","Buenaventura","Buga","Bugalagrande","Caicedonia","Calima","Candelaria","Cartago","Dagua","El Águila","El Cairo","El Cerrito","El Dovio","Florida","Ginebra","Guacarí","Jamundí","La Cumbre","La Unión","La Victoria","Obando","Palmira","Pradera","Restrepo","Riofrío","Roldanillo","San Pedro","Sevilla","Toro","Trujillo","Tuluá","Ulloa","Versalles","Vijes","Yotoco","Yumbo","Zarzal")
    }
  },

  "Vaupés": {
    capital: "Mitú",
    municipios: {
      "Mitú": ["Centro","La Esperanza","Las Brisas","Veinte de Julio","Trece de Junio","Valle Pueblo Nuevo","San Francisco","Acaricuara","Macuro","Comuneros"],
      ...m("Carurú","Taraira","Pacoa","Papunaua","Yavaraté")
    }
  },

  "Vichada": {
    capital: "Puerto Carreño",
    municipios: {
      "Puerto Carreño": ["Centro","La Esperanza","Comuneros","Bicentenario","Las Acacias","Cazuarito","La Primavera","San José","La Florida","Bello Horizonte"],
      ...m("La Primavera","Santa Rosalía","Cumaribo")
    }
  },

}

export const DEPARTAMENTOS = Object.keys(UBICACIONES).sort((a, b) =>
  a.localeCompare(b, 'es', { sensitivity: 'base' })
)
