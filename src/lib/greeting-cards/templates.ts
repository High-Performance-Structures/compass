export type EcardDepartment = "company" | "orc" | "hps" | "nu-tech"
export type EcardStyle = "message" | "photo" | "illustrated" | "legacy"

export type EcardTemplateId =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "o1"
  | "o2"
  | "o3"
  | "o4"
  | "o5"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "n1"
  | "n2"
  | "n3"
  | "n4"
  | "n5"
  | "po1"
  | "po2"
  | "po3"
  | "ph1"
  | "ph2"
  | "ph3"
  | "pn1"
  | "pn2"
  | "pn3"
  | "io1"
  | "io2"
  | "ih1"
  | "ih2"
  | "ih3"
  | "in1"
  | "in3"
  | "appreciation"
  | "celebration"
  | "birthday"
  | "welcome"
  | "thinking-of-you"

export type EcardTemplate = {
  readonly id: EcardTemplateId
  readonly code: string
  readonly name: string
  readonly headline: string
  readonly description: string
  readonly department: EcardDepartment
  readonly style: EcardStyle
  readonly imagePath: string | null
  readonly thumbnailPath: string | null
}

type NewTemplate = Omit<EcardTemplate, "imagePath" | "thumbnailPath">

function imageTemplate(template: NewTemplate): EcardTemplate {
  return {
    ...template,
    imagePath: `/images/ecards/${template.id}.webp`,
    thumbnailPath: `/images/ecards/thumbs/${template.id}.webp`,
  }
}

export const ECARD_TEMPLATES: readonly EcardTemplate[] = [
  imageTemplate({ id: "a", code: "A", name: "Thank You", headline: "Thank you", description: "Company-wide appreciation with an HPS steel frame.", department: "company", style: "message" }),
  imageTemplate({ id: "b", code: "B", name: "Milestone Reached", headline: "Milestone reached", description: "An Open Range project or company milestone.", department: "company", style: "message" }),
  imageTemplate({ id: "c", code: "C", name: "Great Work", headline: "Great work", description: "Nu-Tech recognition for excellent work.", department: "company", style: "message" }),
  imageTemplate({ id: "d", code: "D", name: "Happy Birthday", headline: "Happy birthday!", description: "A festive company birthday greeting.", department: "company", style: "message" }),
  imageTemplate({ id: "e", code: "E", name: "Work Anniversary", headline: "Happy work anniversary", description: "Celebrate an employee work anniversary.", department: "company", style: "message" }),
  imageTemplate({ id: "f", code: "F", name: "Happy Holidays", headline: "Happy holidays", description: "A warm company holiday greeting.", department: "company", style: "message" }),

  imageTemplate({ id: "o1", code: "O1", name: "ORC Thank You", headline: "Thank you", description: "Open Range appreciation with timber-frame details.", department: "orc", style: "message" }),
  imageTemplate({ id: "o2", code: "O2", name: "Welcome Home", headline: "Welcome home", description: "Celebrate a completed Open Range home.", department: "orc", style: "message" }),
  imageTemplate({ id: "o3", code: "O3", name: "Project Milestone", headline: "Project milestone", description: "Recognize great progress on an Open Range project.", department: "orc", style: "message" }),
  imageTemplate({ id: "o4", code: "O4", name: "ORC Congratulations", headline: "Congratulations!", description: "Open Range congratulations for a special achievement.", department: "orc", style: "message" }),
  imageTemplate({ id: "o5", code: "O5", name: "ORC Happy Holidays", headline: "Happy holidays", description: "Holiday wishes from Open Range Construction.", department: "orc", style: "message" }),

  imageTemplate({ id: "h1", code: "H1", name: "HPS Happy Birthday", headline: "Happy birthday!", description: "An HPS birthday greeting.", department: "hps", style: "message" }),
  imageTemplate({ id: "h2", code: "H2", name: "HPS Work Anniversary", headline: "Happy work anniversary", description: "Celebrate an HPS work anniversary.", department: "hps", style: "message" }),
  imageTemplate({ id: "h3", code: "H3", name: "Welcome to the Team", headline: "Welcome to the team", description: "Welcome a new HPS employee.", department: "hps", style: "message" }),
  imageTemplate({ id: "h4", code: "H4", name: "HPS Great Work", headline: "Great work", description: "Recognize commitment and excellent work at HPS.", department: "hps", style: "message" }),
  imageTemplate({ id: "h5", code: "H5", name: "Thinking of You", headline: "Thinking of you", description: "A supportive note from the HPS team.", department: "hps", style: "message" }),

  imageTemplate({ id: "n1", code: "N1", name: "Nu-Tech Thank You", headline: "Thank you", description: "Nu-Tech appreciation with an architectural design.", department: "nu-tech", style: "message" }),
  imageTemplate({ id: "n2", code: "N2", name: "Installation Complete", headline: "Installation complete", description: "Celebrate another Nu-Tech job well done.", department: "nu-tech", style: "message" }),
  imageTemplate({ id: "n3", code: "N3", name: "Nu-Tech Congratulations", headline: "Congratulations!", description: "Recognize innovation and achievement at Nu-Tech.", department: "nu-tech", style: "message" }),
  imageTemplate({ id: "n4", code: "N4", name: "Nu-Tech Happy Birthday", headline: "Happy birthday!", description: "A Nu-Tech birthday greeting.", department: "nu-tech", style: "message" }),
  imageTemplate({ id: "n5", code: "N5", name: "Happy New Year", headline: "Happy New Year", description: "New Year wishes from Nu-Tech Systems.", department: "nu-tech", style: "message" }),

  imageTemplate({ id: "po1", code: "PO1", name: "Timber Frame Interior", headline: "", description: "Wordless Open Range timber-frame interior and mountain view.", department: "orc", style: "photo" }),
  imageTemplate({ id: "po2", code: "PO2", name: "Mountain Home at Sunset", headline: "", description: "Wordless Open Range mountain-home exterior at sunset.", department: "orc", style: "photo" }),
  imageTemplate({ id: "po3", code: "PO3", name: "Mountain Entry", headline: "", description: "Wordless Open Range home entry with an autumn mountain view.", department: "orc", style: "photo" }),
  imageTemplate({ id: "ph1", code: "PH1", name: "Winter Mountain Home", headline: "", description: "Wordless HPS mountain home in winter.", department: "hps", style: "photo" }),
  imageTemplate({ id: "ph2", code: "PH2", name: "Steel Frame at Sunset", headline: "", description: "Wordless HPS structural-steel frame at sunset.", department: "hps", style: "photo" }),
  imageTemplate({ id: "ph3", code: "PH3", name: "Timber Connection", headline: "", description: "Wordless HPS close-up of a timber connection.", department: "hps", style: "photo" }),
  imageTemplate({ id: "pn1", code: "PN1", name: "ICF Site at Sunset", headline: "", description: "Wordless Nu-Tech ICF construction site at sunset.", department: "nu-tech", style: "photo" }),
  imageTemplate({ id: "pn2", code: "PN2", name: "Modern Completed Home", headline: "", description: "Wordless Nu-Tech modern completed home.", department: "nu-tech", style: "photo" }),
  imageTemplate({ id: "pn3", code: "PN3", name: "ICF Craftsmanship", headline: "", description: "Wordless Nu-Tech close-up of ICF construction work.", department: "nu-tech", style: "photo" }),

  imageTemplate({ id: "io1", code: "IO1", name: "Mountain Lodge Illustration", headline: "", description: "Wordless Open Range illustrated mountain lodge.", department: "orc", style: "illustrated" }),
  imageTemplate({ id: "io2", code: "IO2", name: "Timber Raising Illustration", headline: "", description: "Wordless Open Range illustrated timber-frame raising.", department: "orc", style: "illustrated" }),
  imageTemplate({ id: "ih1", code: "IH1", name: "Autumn Entry Illustration", headline: "", description: "Wordless HPS illustrated mountain entry in autumn.", department: "hps", style: "illustrated" }),
  imageTemplate({ id: "ih2", code: "IH2", name: "Winter Home Illustration", headline: "", description: "Wordless HPS illustrated mountain home in winter.", department: "hps", style: "illustrated" }),
  imageTemplate({ id: "ih3", code: "IH3", name: "Timber Connection Illustration", headline: "", description: "Wordless HPS illustrated timber connection at sunset.", department: "hps", style: "illustrated" }),
  imageTemplate({ id: "in1", code: "IN1", name: "ICF Interior Illustration", headline: "", description: "Wordless Nu-Tech illustrated ICF interior under construction.", department: "nu-tech", style: "illustrated" }),
  imageTemplate({ id: "in3", code: "IN3", name: "ICF Building Illustration", headline: "", description: "Wordless Nu-Tech illustrated ICF building under construction.", department: "nu-tech", style: "illustrated" }),
]

const LEGACY_ECARD_TEMPLATES: readonly EcardTemplate[] = [
  { id: "appreciation", code: "Legacy", name: "With Appreciation", headline: "Thank you", description: "A warm, professional note of thanks.", department: "company", style: "legacy", imagePath: null, thumbnailPath: null },
  { id: "celebration", code: "Legacy", name: "Celebrate", headline: "Congratulations!", description: "For milestones, achievements, and great news.", department: "company", style: "legacy", imagePath: null, thumbnailPath: null },
  { id: "birthday", code: "Legacy", name: "Happy Birthday", headline: "Happy Birthday!", description: "A bright birthday greeting from the HPS team.", department: "company", style: "legacy", imagePath: null, thumbnailPath: null },
  { id: "welcome", code: "Legacy", name: "Welcome", headline: "Welcome to the team", description: "For new employees and new working relationships.", department: "company", style: "legacy", imagePath: null, thumbnailPath: null },
  { id: "thinking-of-you", code: "Legacy", name: "Thinking of You", headline: "Thinking of you", description: "A considerate note for support and encouragement.", department: "company", style: "legacy", imagePath: null, thumbnailPath: null },
]

export function getEcardTemplate(value: string): EcardTemplate | null {
  return [...ECARD_TEMPLATES, ...LEGACY_ECARD_TEMPLATES].find(
    (template) => template.id === value,
  ) ?? null
}

export function getActiveEcardTemplate(value: string): EcardTemplate | null {
  return ECARD_TEMPLATES.find((template) => template.id === value) ?? null
}
