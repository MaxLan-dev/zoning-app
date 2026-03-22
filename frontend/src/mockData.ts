import type { Feature, Polygon } from 'geojson'

export type ZoneRecord = {
  id: string
  areaName: string
  municipality: string
  neighborhood: string
  zoneCode: string
  zoneCategory: string
  zoneType: string
  summary: string
  permittedHousing: string[]
  minLotSizeSqm: number
  maxHeightM: number
  parkingRequirement: string
  parkingSpacesPerUnit: number
  setbacks: {
    front: number
    side: number
    rear: number
  }
  density: string
  densityUnitsPerHectare: number
  additionalUnitRule: string
  multiFamilyAllowed: boolean
  additionalUnitAllowed: boolean
  floodplain: boolean
  restrictionScore: number
  affordabilityImpact: 'Low' | 'Moderate' | 'High'
  housingAvailability: 'Limited' | 'Mixed' | 'Broad'
  whyItMatters: string
  evidence: EvidenceItem[]
  geometry: Feature<Polygon>
  centroid: [number, number]
}

export type EvidenceItem = {
  id: string
  title: string
  excerpt: string
  citation: string
  url: string
}

export type OverlayFeature = {
  id: string
  name: string
  label: string
  description: string
  color: string
  fillOpacity: number
  geometry: Feature<Polygon>
}

export type SavedView = {
  id: string
  name: string
  description: string
  zoneIds: string[]
}

function rectangle(
  west: number,
  south: number,
  east: number,
  north: number,
): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  }
}

export const mockZones: ZoneRecord[] = [
  {
    id: 'waterloo-uptown-rmu-20',
    areaName: 'Uptown Mixed-Use Corridor',
    municipality: 'Waterloo',
    neighborhood: 'Uptown',
    zoneCode: 'RMU-20',
    zoneCategory: 'Residential Mixed Use',
    zoneType: 'Mixed-use node',
    summary:
      'Mid-rise mixed-use zoning intended to support apartments, townhouses, and active street-front retail near rapid transit.',
    permittedHousing: ['Apartment', 'Mixed-use', 'Townhouse'],
    minLotSizeSqm: 450,
    maxHeightM: 20,
    parkingRequirement: '1 space per additional residential unit; reduced parking near transit.',
    parkingSpacesPerUnit: 1,
    setbacks: { front: 3, side: 1.5, rear: 7.5 },
    density: 'Up to 220 units/ha with active frontage standards.',
    densityUnitsPerHectare: 220,
    additionalUnitRule:
      'Additional residential units are permitted where access, waste storage, and bicycle parking requirements are met.',
    multiFamilyAllowed: true,
    additionalUnitAllowed: true,
    floodplain: false,
    restrictionScore: 41,
    affordabilityImpact: 'Moderate',
    housingAvailability: 'Broad',
    whyItMatters:
      'This zone is comparatively supportive of missing-middle and apartment housing, making it a strong candidate for infill and mixed-use intensification.',
    evidence: [
      {
        id: 'uptown-permitted-uses',
        title: 'Permitted uses in RMU-20',
        excerpt:
          'Apartment dwellings, mixed-use buildings, and townhouse dwellings are permitted within the RMU-20 zone subject to frontage, amenity area, and stepback provisions.',
        citation: 'City of Waterloo Zoning By-law, Table 8C',
        url: 'https://www.waterloo.ca/en/government/resources/Documents/Bylaws/Zoning-Bylaw.pdf',
      },
      {
        id: 'uptown-height',
        title: 'Maximum height and transition rules',
        excerpt:
          'A maximum height of 20 metres applies, with upper-storey stepbacks required where a lot abuts a low-rise residential zone.',
        citation: 'City of Waterloo Zoning By-law, Section 8.3.4',
        url: 'https://www.waterloo.ca/en/government/resources/Documents/Bylaws/Zoning-Bylaw.pdf',
      },
    ],
    geometry: rectangle(-80.534, 43.458, -80.518, 43.469),
    centroid: [43.4635, -80.526],
  },
  {
    id: 'waterloo-westmount-r4',
    areaName: 'Westmount Residential Transition',
    municipality: 'Waterloo',
    neighborhood: 'Westmount',
    zoneCode: 'R4',
    zoneCategory: 'Residential Medium Density',
    zoneType: 'Neighbourhood residential',
    summary:
      'A transitional residential area that permits small apartment buildings and stacked townhouses with lower heights and deeper setbacks.',
    permittedHousing: ['Townhouse', 'Stacked townhouse', 'Fourplex'],
    minLotSizeSqm: 520,
    maxHeightM: 12,
    parkingRequirement: '1.25 spaces per dwelling unit plus visitor parking for larger developments.',
    parkingSpacesPerUnit: 1.25,
    setbacks: { front: 6, side: 1.8, rear: 7.5 },
    density: 'Up to 90 units/ha with landscaped open space requirements.',
    densityUnitsPerHectare: 90,
    additionalUnitRule:
      'One accessory dwelling unit may be permitted where the principal building remains the dominant use on the lot.',
    multiFamilyAllowed: true,
    additionalUnitAllowed: true,
    floodplain: false,
    restrictionScore: 63,
    affordabilityImpact: 'High',
    housingAvailability: 'Mixed',
    whyItMatters:
      'Height and parking standards are more restrictive here, which can reduce redevelopment feasibility despite allowing moderate-density housing forms.',
    evidence: [
      {
        id: 'westmount-density',
        title: 'Density and lot coverage',
        excerpt:
          'Medium-density residential development shall provide landscaped open space and comply with maximum lot coverage and density standards.',
        citation: 'City of Waterloo Zoning By-law, Section 7.2.1',
        url: 'https://www.waterloo.ca/en/government/resources/Documents/Bylaws/Zoning-Bylaw.pdf',
      },
      {
        id: 'westmount-parking',
        title: 'Parking supply requirement',
        excerpt:
          'Residential developments in this zone require 1.25 parking spaces per dwelling unit unless a reduced standard is authorized through site plan approval.',
        citation: 'City of Waterloo Zoning By-law, Table 6A',
        url: 'https://www.waterloo.ca/en/government/resources/Documents/Bylaws/Zoning-Bylaw.pdf',
      },
    ],
    geometry: rectangle(-80.549, 43.451, -80.535, 43.461),
    centroid: [43.456, -80.542],
  },
  {
    id: 'kitchener-downtown-d6',
    areaName: 'Downtown Growth District',
    municipality: 'Kitchener',
    neighborhood: 'Downtown',
    zoneCode: 'D-6',
    zoneCategory: 'Downtown Mixed Use',
    zoneType: 'Urban growth centre',
    summary:
      'High-intensity mixed-use zoning around transit with broad permissions for apartment housing, office, institutional, and retail uses.',
    permittedHousing: ['Apartment', 'Mixed-use', 'Live-work'],
    minLotSizeSqm: 320,
    maxHeightM: 30,
    parkingRequirement: '0.7 spaces per dwelling unit with shared parking and transportation demand management incentives.',
    parkingSpacesPerUnit: 0.7,
    setbacks: { front: 0, side: 0, rear: 3 },
    density: 'Up to 350 units/ha and tower forms supported in strategic growth areas.',
    densityUnitsPerHectare: 350,
    additionalUnitRule:
      'Accessory residential units are generally addressed through mixed-use building permissions rather than detached accessory unit provisions.',
    multiFamilyAllowed: true,
    additionalUnitAllowed: false,
    floodplain: false,
    restrictionScore: 28,
    affordabilityImpact: 'Low',
    housingAvailability: 'Broad',
    whyItMatters:
      'This is the most permissive zone in the sample set and best aligned with high-density housing production near jobs and rapid transit.',
    evidence: [
      {
        id: 'downtown-height',
        title: 'Downtown height permissions',
        excerpt:
          'A maximum height of 30 metres applies, with active frontage and stepback design requirements along priority streets.',
        citation: 'City of Kitchener Zoning By-law, Section 17.6',
        url: 'https://www.kitchener.ca/en/resourcesGeneral/Documents/DSD_PLAN_City-of-Kitchener-Zoning-Bylaw.pdf',
      },
      {
        id: 'downtown-parking',
        title: 'Reduced parking near rapid transit',
        excerpt:
          'Parking minimums may be reduced within the rapid transit station area and downtown mixed-use zones where mobility options are available.',
        citation: 'City of Kitchener Zoning By-law, Table 7-3',
        url: 'https://www.kitchener.ca/en/resourcesGeneral/Documents/DSD_PLAN_City-of-Kitchener-Zoning-Bylaw.pdf',
      },
    ],
    geometry: rectangle(-80.5005, 43.4455, -80.485, 43.4575),
    centroid: [43.4515, -80.4925],
  },
  {
    id: 'cambridge-galt-mu3',
    areaName: 'Galt Core Mixed-Use Precinct',
    municipality: 'Cambridge',
    neighborhood: 'Galt',
    zoneCode: 'MU-3',
    zoneCategory: 'Mixed Use Corridor',
    zoneType: 'Historic core',
    summary:
      'Mixed-use permissions support apartments and commercial uses, but floodplain constraints and heritage context shape redevelopment potential.',
    permittedHousing: ['Apartment', 'Mixed-use', 'Townhouse'],
    minLotSizeSqm: 400,
    maxHeightM: 24,
    parkingRequirement: '0.9 spaces per dwelling unit; transportation demand management report required for larger projects.',
    parkingSpacesPerUnit: 0.9,
    setbacks: { front: 1.5, side: 1.2, rear: 6 },
    density: 'Up to 180 units/ha subject to conservation authority review in overlay areas.',
    densityUnitsPerHectare: 180,
    additionalUnitRule:
      'Additional units may be permitted, but proposals within the floodplain overlay require hazard screening and emergency access review.',
    multiFamilyAllowed: true,
    additionalUnitAllowed: true,
    floodplain: true,
    restrictionScore: 57,
    affordabilityImpact: 'Moderate',
    housingAvailability: 'Mixed',
    whyItMatters:
      'The base zone supports housing growth, but overlay conditions can slow approvals and materially affect buildable area and cost.',
    evidence: [
      {
        id: 'galt-floodplain',
        title: 'Floodplain overlay provisions',
        excerpt:
          'Development within the floodplain overlay shall demonstrate safe access and satisfy conservation authority requirements prior to building permit issuance.',
        citation: 'City of Cambridge Zoning By-law, Overlay Section 3.18',
        url: 'https://www.cambridge.ca/en/your-city/resources/Documents/Zoning-Bylaw.pdf',
      },
      {
        id: 'galt-uses',
        title: 'Mixed-use permissions in MU-3',
        excerpt:
          'Apartment dwellings above the ground floor and mixed-use buildings are permitted in the MU-3 zone, subject to urban design controls.',
        citation: 'City of Cambridge Zoning By-law, Section 11.4',
        url: 'https://www.cambridge.ca/en/your-city/resources/Documents/Zoning-Bylaw.pdf',
      },
    ],
    geometry: rectangle(-80.3235, 43.353, -80.3085, 43.3645),
    centroid: [43.3588, -80.316],
  },
  {
    id: 'waterloo-northfield-mr25',
    areaName: 'Northfield Station Mid-Rise',
    municipality: 'Waterloo',
    neighborhood: 'Northfield',
    zoneCode: 'MR-25',
    zoneCategory: 'Mid-Rise Residential',
    zoneType: 'Transit-supportive residential',
    summary:
      'Mid-rise residential zoning near employment lands and transit that supports apartments, stacked townhouses, and community-serving uses.',
    permittedHousing: ['Apartment', 'Stacked townhouse', 'Seniors housing'],
    minLotSizeSqm: 380,
    maxHeightM: 25,
    parkingRequirement: '0.85 spaces per dwelling unit with visitor parking shared across the block.',
    parkingSpacesPerUnit: 0.85,
    setbacks: { front: 4, side: 2, rear: 7.5 },
    density: 'Up to 260 units/ha with podium and transition requirements.',
    densityUnitsPerHectare: 260,
    additionalUnitRule:
      'Additional units are permitted in ground-related forms where separate entry, servicing, and amenity space standards are satisfied.',
    multiFamilyAllowed: true,
    additionalUnitAllowed: true,
    floodplain: false,
    restrictionScore: 36,
    affordabilityImpact: 'Low',
    housingAvailability: 'Broad',
    whyItMatters:
      'This zone balances strong housing permissions with manageable form standards, making it comparatively favourable for multifamily development.',
    evidence: [
      {
        id: 'northfield-height',
        title: 'Mid-rise envelope and transition',
        excerpt:
          'Development may reach 25 metres where podium articulation, tower separation, and shadow transition criteria are satisfied.',
        citation: 'City of Waterloo Zoning By-law, Section 9.1',
        url: 'https://www.waterloo.ca/en/government/resources/Documents/Bylaws/Zoning-Bylaw.pdf',
      },
      {
        id: 'northfield-parking',
        title: 'Transit-supportive parking standard',
        excerpt:
          'Reduced parking minimums apply within station area planning districts, with shared parking encouraged across coordinated developments.',
        citation: 'City of Waterloo Zoning By-law, Table 6B',
        url: 'https://www.waterloo.ca/en/government/resources/Documents/Bylaws/Zoning-Bylaw.pdf',
      },
    ],
    geometry: rectangle(-80.556, 43.488, -80.541, 43.4995),
    centroid: [43.4938, -80.5485],
  },
  {
    id: 'kitchener-stanley-a1',
    areaName: 'Stanley Park Low-Rise Neighbourhood',
    municipality: 'Kitchener',
    neighborhood: 'Stanley Park',
    zoneCode: 'A-1',
    zoneCategory: 'Low-Rise Residential',
    zoneType: 'Stable neighbourhood',
    summary:
      'Predominantly low-rise zoning that prioritizes detached and semi-detached forms with tighter permissions on density and height.',
    permittedHousing: ['Detached', 'Semi-detached', 'Accessory unit'],
    minLotSizeSqm: 560,
    maxHeightM: 11,
    parkingRequirement: '1.5 spaces per dwelling unit; driveway-based supply commonly required.',
    parkingSpacesPerUnit: 1.5,
    setbacks: { front: 6, side: 1.8, rear: 7.5 },
    density: 'Up to 55 units/ha with lot frontage minimums.',
    densityUnitsPerHectare: 55,
    additionalUnitRule:
      'An accessory dwelling unit is permitted subject to owner-occupancy and exterior access conditions.',
    multiFamilyAllowed: false,
    additionalUnitAllowed: true,
    floodplain: false,
    restrictionScore: 74,
    affordabilityImpact: 'High',
    housingAvailability: 'Limited',
    whyItMatters:
      'This zone illustrates how height, parking, and low-density form standards can constrain housing choice in otherwise serviced urban neighbourhoods.',
    evidence: [
      {
        id: 'stanley-height',
        title: 'Low-rise height standard',
        excerpt:
          'Buildings shall not exceed 11 metres in height and must maintain front and rear yard setbacks consistent with neighbourhood character.',
        citation: 'City of Kitchener Zoning By-law, Section 5.2',
        url: 'https://www.kitchener.ca/en/resourcesGeneral/Documents/DSD_PLAN_City-of-Kitchener-Zoning-Bylaw.pdf',
      },
      {
        id: 'stanley-adu',
        title: 'Accessory dwelling unit permissions',
        excerpt:
          'One accessory dwelling unit may be permitted in a detached dwelling where parking and access requirements are satisfied.',
        citation: 'City of Kitchener Zoning By-law, Section 4.16',
        url: 'https://www.kitchener.ca/en/resourcesGeneral/Documents/DSD_PLAN_City-of-Kitchener-Zoning-Bylaw.pdf',
      },
    ],
    geometry: rectangle(-80.448, 43.468, -80.431, 43.479),
    centroid: [43.4735, -80.4395],
  },
]

export const neighborhoodOverlays: OverlayFeature[] = [
  {
    id: 'uptown-neighborhood',
    name: 'Uptown Waterloo',
    label: 'Planning community',
    description: 'Urban growth node with mixed-use intensification focus.',
    color: '#6f88b7',
    fillOpacity: 0.05,
    geometry: rectangle(-80.539, 43.454, -80.514, 43.4725),
  },
  {
    id: 'downtown-neighborhood',
    name: 'Downtown Kitchener',
    label: 'Planning community',
    description: 'Primary downtown growth area and innovation district.',
    color: '#6f88b7',
    fillOpacity: 0.05,
    geometry: rectangle(-80.506, 43.442, -80.482, 43.461),
  },
  {
    id: 'galt-neighborhood',
    name: 'Galt Core',
    label: 'Planning community',
    description: 'Historic core with mixed-use and heritage overlays.',
    color: '#6f88b7',
    fillOpacity: 0.05,
    geometry: rectangle(-80.329, 43.349, -80.304, 43.367),
  },
]

export const districtPlanOverlays: OverlayFeature[] = [
  {
    id: 'uptown-secondary-plan',
    name: 'Uptown Secondary Plan',
    label: 'District plan',
    description: 'Focuses growth around active transportation corridors and mid-rise housing.',
    color: '#3c8c7a',
    fillOpacity: 0.08,
    geometry: rectangle(-80.541, 43.455, -80.512, 43.474),
  },
  {
    id: 'innovation-district-plan',
    name: 'Innovation District Plan',
    label: 'District plan',
    description: 'Guides high-intensity office, institutional, and residential growth.',
    color: '#3c8c7a',
    fillOpacity: 0.08,
    geometry: rectangle(-80.507, 43.443, -80.4815, 43.459),
  },
]

export const floodplainOverlays: OverlayFeature[] = [
  {
    id: 'grand-river-floodplain',
    name: 'Grand River Floodplain',
    label: 'Floodplain overlay',
    description: 'Hazard screening and safe access review apply.',
    color: '#8a6ce6',
    fillOpacity: 0.12,
    geometry: rectangle(-80.3275, 43.3515, -80.306, 43.3655),
  },
]

export const savedViews: SavedView[] = [
  {
    id: 'station-area-opportunity',
    name: 'Transit-supportive opportunity areas',
    description: 'Zones with lower parking requirements and mid- to high-density permissions.',
    zoneIds: ['waterloo-uptown-rmu-20', 'kitchener-downtown-d6', 'waterloo-northfield-mr25'],
  },
  {
    id: 'parking-heavy-neighborhoods',
    name: 'Parking-heavy neighbourhoods',
    description: 'Areas where parking minimums likely raise housing delivery costs.',
    zoneIds: ['waterloo-westmount-r4', 'kitchener-stanley-a1'],
  },
]

export const municipalities = ['Waterloo', 'Kitchener', 'Cambridge']
