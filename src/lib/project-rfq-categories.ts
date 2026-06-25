export type RfqVendorCategoryOption = {
  readonly label: string
  readonly division: string | null
}

export const RFQ_VENDOR_CATEGORY_OPTIONS: readonly RfqVendorCategoryOption[] = [
  { label: "Concrete", division: "03" },
  { label: "Masonry", division: "04" },
  { label: "Structural Steel / Metals", division: "05" },
  { label: "Framing / Rough Carpentry", division: "06" },
  { label: "Finish Carpentry / Millwork", division: "06" },
  { label: "Waterproofing", division: "07" },
  { label: "Roofing", division: "07" },
  { label: "Exterior Siding / Cladding", division: "07" },
  { label: "Doors / Windows / Openings", division: "08" },
  { label: "Drywall / Gypsum", division: "09" },
  { label: "Flooring", division: "09" },
  { label: "Tile / Stone", division: "09" },
  { label: "Painting / Coatings", division: "09" },
  { label: "Specialties", division: "10" },
  { label: "Appliances / Equipment", division: "11" },
  { label: "Cabinets / Countertops", division: "12" },
  { label: "Window Treatments", division: "12" },
  { label: "Fire Suppression", division: "21" },
  { label: "Plumbing", division: "22" },
  { label: "HVAC / Mechanical", division: "23" },
  { label: "Electrical", division: "26" },
  { label: "Low Voltage / Communications", division: "27" },
  { label: "Security / Access Control", division: "28" },
  { label: "Earthwork / Excavation", division: "31" },
  { label: "Exterior Improvements / Hardscape", division: "32" },
  { label: "Utilities", division: "33" },
  { label: "Supplier", division: null },
  { label: "Consultant", division: null },
  { label: "Miscellaneous Vendor", division: null },
]

