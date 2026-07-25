export type ExamType = 'neet' | 'jee_main' | 'jee_advanced' | 'boards' | 'cuet' | 'olympiad' | 'foundation' | 'custom';

export type TaxonomyNode = { id: string; label: string; children?: TaxonomyNode[] };

export const EXAM_TYPES: { id: ExamType; label: string }[] = [
  { id: 'neet', label: 'NEET' },
  { id: 'jee_main', label: 'JEE Main' },
  { id: 'jee_advanced', label: 'JEE Advanced' },
  { id: 'boards', label: 'Boards' },
  { id: 'cuet', label: 'CUET' },
  { id: 'olympiad', label: 'Olympiad' },
  { id: 'foundation', label: 'Foundation' },
  { id: 'custom', label: 'Custom' },
];

export const QUESTION_TYPES = [
  { id: 'single_choice', label: 'Single Correct', shortLabel: 'MCQ' },
  { id: 'multiple_choice', label: 'Multiple Correct', shortLabel: 'MMCQ' },
  { id: 'integer_type', label: 'Integer Type', shortLabel: 'INT' },
  { id: 'numerical', label: 'Numerical', shortLabel: 'NUM' },
  { id: 'true_false', label: 'True / False', shortLabel: 'T/F' },
  { id: 'assertion_reason', label: 'Assertion-Reason', shortLabel: 'A-R' },
  { id: 'match_column', label: 'Match the Column', shortLabel: 'MAT' },
  { id: 'matrix_match', label: 'Matrix Match', shortLabel: 'MMX' },
  { id: 'case_study', label: 'Case Study / Paragraph', shortLabel: 'CAS' },
  { id: 'paragraph', label: 'Comprehension', shortLabel: 'CMP' },
  { id: 'fill_blank', label: 'Fill in the Blank', shortLabel: 'FIB' },
  { id: 'short_answer', label: 'Short Answer', shortLabel: 'SA' },
  { id: 'long_answer', label: 'Long Answer', shortLabel: 'LA' },
] as const;

export const DIFFICULTY_LEVELS = [
  { id: 'easy', label: 'Easy', color: 'emerald' },
  { id: 'medium', label: 'Medium', color: 'amber' },
  { id: 'hard', label: 'Hard', color: 'rose' },
  { id: 'olympiad', label: 'Olympiad', color: 'violet' },
  { id: 'advanced', label: 'Advanced', color: 'red' },
] as const;

export const QUESTION_SOURCES = [
  { id: 'self', label: 'Self Created' },
  { id: 'nta', label: 'NTA' },
  { id: 'jee_main', label: 'JEE Main Previous Year' },
  { id: 'jee_advanced', label: 'JEE Advanced Previous Year' },
  { id: 'neet', label: 'NEET Previous Year' },
  { id: 'ncert', label: 'NCERT' },
  { id: 'hc_verma', label: 'HC Verma' },
  { id: 'dc_pandey', label: 'DC Pandey' },
  { id: 'ms_chauhan', label: 'MS Chauhan' },
  { id: 'previous_year', label: 'Previous Year Paper' },
  { id: 'ai_generated', label: 'AI Generated' },
  { id: 'imported_pdf', label: 'Imported PDF' },
  { id: 'ocr', label: 'OCR Scanned' },
] as const;

export const QUESTION_TAGS = [
  { id: 'favourite', label: 'Favourite', icon: '★' },
  { id: 'important', label: 'Important', icon: '!' },
  { id: 'repeated', label: 'Repeated', icon: '↻' },
  { id: 'previous_year', label: 'Previous Year', icon: ' clock' },
  { id: 'formula_based', label: 'Formula Based', icon: 'f' },
  { id: 'calculation', label: 'Calculation', icon: '#' },
  { id: 'conceptual', label: 'Conceptual', icon: '?' },
  { id: 'ncert', label: 'NCERT', icon: 'B' },
  { id: 'revision', label: 'Revision', icon: 'R' },
] as const;

export const BLOOM_LEVELS = [
  { id: 'remember', label: 'Remember' },
  { id: 'understand', label: 'Understand' },
  { id: 'apply', label: 'Apply' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'evaluate', label: 'Evaluate' },
  { id: 'create', label: 'Create' },
] as const;

export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'Hindi' },
  { id: 'en_hi', label: 'English + Hindi' },
  { id: 'bn', label: 'Bengali' },
  { id: 'ta', label: 'Tamil' },
  { id: 'te', label: 'Telugu' },
  { id: 'mr', label: 'Marathi' },
  { id: 'gu', label: 'Gujarati' },
  { id: 'kn', label: 'Kannada' },
  { id: 'ml', label: 'Malayalam' },
] as const;

// ──────────────────────────────────────────────────────
// HIERARCHICAL TAXONOMY: Exam → Subject → Chapter → Topic → SubTopic
// ──────────────────────────────────────────────────────

const PHYSICS_CHAPTERS: TaxonomyNode[] = [
  { id: 'ch_units', label: 'Units and Measurements', children: [
    { id: 'st_system_of_units', label: 'System of Units' },
    { id: 'st_dimensional_analysis', label: 'Dimensional Analysis' },
    { id: 'st_errors', label: 'Errors and Significant Figures' },
    { id: 'st_vernier_caliper', label: 'Vernier Caliper & Screw Gauge' },
  ]},
  { id: 'ch_motion', label: 'Motion in a Straight Line', children: [
    { id: 'st_distance_displacement', label: 'Distance vs Displacement' },
    { id: 'st_velocity_acceleration', label: 'Velocity and Acceleration' },
    { id: 'st_equations', label: 'Equations of Motion' },
    { id: 'st_free_fall', label: 'Free Fall' },
    { id: 'st_relative_motion', label: 'Relative Motion in 1D' },
  ]},
  { id: 'ch_motion_plane', label: 'Motion in a Plane', children: [
    { id: 'st_vectors', label: 'Vectors' },
    { id: 'st_projectile', label: 'Projectile Motion' },
    { id: 'st_circular', label: 'Circular Motion' },
  ]},
  { id: 'ch_laws', label: 'Laws of Motion', children: [
    { id: 'st_newton_laws', label: "Newton's Laws" },
    { id: 'st_fbd', label: 'Free Body Diagram' },
    { id: 'st_friction', label: 'Friction' },
    { id: 'st_pseudo', label: 'Pseudo Force' },
    { id: 'st_circular_motion', label: 'Circular Motion Dynamics' },
    { id: 'st_constraint', label: 'Constraint Motion' },
    { id: 'st_pulley', label: 'Pulley Systems' },
    { id: 'st_connected', label: 'Connected Bodies' },
    { id: 'st_elevator', label: 'Elevator Problems' },
  ]},
  { id: 'ch_work', label: 'Work, Energy and Power', children: [
    { id: 'st_work_energy', label: 'Work and Kinetic Energy' },
    { id: 'st_potential', label: 'Potential Energy' },
    { id: 'stConservation', label: 'Conservation of Energy' },
    { id: 'st_power', label: 'Power' },
    { id: 'st_collisions', label: 'Collisions' },
  ]},
  { id: 'ch_rotation', label: 'Rotational Motion', children: [
    { id: 'st_moment', label: 'Moment of Inertia' },
    { id: 'st_torque', label: 'Torque and Angular Momentum' },
    { id: 'st_rolling', label: 'Rolling Motion' },
    { id: 'st_equilibrium', label: 'Rotational Equilibrium' },
  ]},
  { id: 'ch_gravitation', label: 'Gravitation', children: [
    { id: 'st_newton_law_gravity', label: "Newton's Law of Gravitation" },
    { id: 'st_kepler', label: "Kepler's Laws" },
    { id: 'st_orbital', label: 'Orbital Velocity and Escape Velocity' },
    { id: 'st_satellite', label: 'Satellite Motion' },
  ]},
  { id: 'ch_thermo', label: 'Thermodynamics', children: [
    { id: 'st_ktg', label: 'Kinetic Theory of Gases' },
    { id: 'st_laws_thermo', label: 'Laws of Thermodynamics' },
    { id: 'st_heat', label: 'Heat and Calorimetry' },
    { id: 'st_carnot', label: 'Carnot Engine' },
  ]},
  { id: 'ch_shm', label: 'Simple Harmonic Motion', children: [
    { id: 'st_spring', label: 'Spring Mass System' },
    { id: 'st_pendulum', label: 'Pendulum' },
    { id: 'st_damped', label: 'Damped and Forced Oscillations' },
  ]},
  { id: 'ch_waves', label: 'Waves', children: [
    { id: 'st_wave_speed', label: 'Wave Speed and Properties' },
    { id: 'st_superposition', label: 'Superposition and Standing Waves' },
    { id: 'st_beats', label: 'Beats' },
    { id: 'st_doppler', label: 'Doppler Effect' },
  ]},
  { id: 'ch_electrostatics', label: 'Electrostatics', children: [
    { id: 'st_coulomb', label: "Coulomb's Law" },
    { id: 'st_electric_field', label: 'Electric Field' },
    { id: 'st_potential_elec', label: 'Electric Potential' },
    { id: 'st_capacitor', label: 'Capacitors' },
  ]},
  { id: 'ch_current', label: 'Current Electricity', children: [
    { id: 'st_ohm', label: "Ohm's Law" },
    { id: 'st_kirchhoff', label: "Kirchhoff's Laws" },
    { id: 'st_wheatstone', label: 'Wheatstone Bridge' },
    { id: 'st_meter_bridge', label: 'Meter Bridge & Potentiometer' },
  ]},
  { id: 'ch_magnetism', label: 'Magnetism and EMI', children: [
    { id: 'st_biot_savart', label: 'Biot-Savart Law' },
    { id: 'st_ampere', label: "Ampere's Law" },
    { id: 'st_lorentz', label: 'Lorentz Force' },
    { id: 'st_faraday', label: "Faraday's Law" },
    { id: 'st_inductance', label: 'Self and Mutual Inductance' },
  ]},
  { id: 'ch_modern', label: 'Modern Physics', children: [
    { id: 'st_photoelectric', label: 'Photoelectric Effect' },
    { id: 'st_bohr', label: 'Bohr Model' },
    { id: 'st_nuclear', label: 'Nuclear Physics' },
    { id: 'st_radioactivity', label: 'Radioactivity' },
  ]},
  { id: 'ch_semiconductor', label: 'Semiconductors', children: [
    { id: 'st_pn_junction', label: 'PN Junction Diode' },
    { id: 'st_transistor', label: 'Transistor' },
    { id: 'st_logic_gates', label: 'Logic Gates' },
  ]},
  { id: 'ch_communication', label: 'Communication Systems', children: [
    { id: 'st_modulation', label: 'Modulation and Demodulation' },
    { id: 'st_bandwidth', label: 'Bandwidth and Signals' },
  ]},
  { id: 'ch_optics', label: 'Optics', children: [
    { id: 'st_reflection', label: 'Reflection' },
    { id: 'st_refraction', label: 'Refraction' },
    { id: 'st_lens', label: 'Lenses and Mirrors' },
    { id: 'st_wave_optics', label: 'Wave Optics' },
    { id: 'st_interference', label: 'Interference and Diffraction' },
  ]},
  { id: 'ch_properties', label: 'Properties of Matter', children: [
    { id: 'st_elasticity', label: 'Elasticity' },
    { id: 'st_viscosity', label: 'Viscosity' },
    { id: 'st_surface_tension', label: 'Surface Tension' },
  ]},
];

const CHEMISTRY_CHAPTERS: TaxonomyNode[] = [
  { id: 'ch_mole', label: 'Mole Concept', children: [
    { id: 'st_mole_calc', label: 'Mole Calculations' },
    { id: 'st_stoichiometry', label: 'Stoichiometry' },
    { id: 'st_limiting', label: 'Limiting Reagent' },
    { id: 'st_empirical', label: 'Empirical & Molecular Formula' },
  ]},
  { id: 'ch_atomic', label: 'Atomic Structure', children: [
    { id: 'st_bohr_model', label: 'Bohr Model' },
    { id: 'st_quantum', label: 'Quantum Numbers' },
    { id: 'st_orbital', label: 'Orbital Shapes' },
    { id: 'st_elec_config', label: 'Electronic Configuration' },
  ]},
  { id: 'ch_periodic', label: 'Periodic Table', children: [
    { id: 'st_periodic_trends', label: 'Periodic Trends' },
    { id: 'st_group_properties', label: 'Group-wise Properties' },
  ]},
  { id: 'ch_bonding', label: 'Chemical Bonding', children: [
    { id: 'st_ionic', label: 'Ionic Bonding' },
    { id: 'st_covalent', label: 'Covalent Bonding' },
    { id: 'st_vbt', label: 'VBT and Hybridization' },
    { id: 'st_mot', label: 'Molecular Orbital Theory' },
    { id: 'st_vsepr', label: 'VSEPR Theory' },
  ]},
  { id: 'ch_thermo_chem', label: 'Thermodynamics (Chemistry)', children: [
    { id: 'st_enthalpy', label: 'Enthalpy' },
    { id: 'st_hess', label: "Hess's Law" },
    { id: 'st_entropy', label: 'Entropy and Gibbs Energy' },
  ]},
  { id: 'ch_equilibrium', label: 'Equilibrium', children: [
    { id: 'st_chemical_eq', label: 'Chemical Equilibrium' },
    { id: 'st_ionic_eq', label: 'Ionic Equilibrium' },
    { id: 'st_buffers', label: 'Buffer Solutions' },
    { id: 'st_solubility', label: 'Solubility Product' },
  ]},
  { id: 'ch_redox', label: 'Redox Reactions', children: [
    { id: 'st_oxidation', label: 'Oxidation Numbers' },
    { id: 'st_electrochemistry', label: 'Electrochemistry' },
    { id: 'st_cells', label: 'Galvanic Cells' },
  ]},
  { id: 'ch_organic_basic', label: 'Organic Chemistry Basics', children: [
    { id: 'st_iupac', label: 'IUPAC Nomenclature' },
    { id: 'st_isomerism', label: 'Isomerism' },
    { id: 'st_reaction_mech', label: 'Reaction Mechanisms' },
  ]},
  { id: 'ch_hydrocarbons', label: 'Hydrocarbons', children: [
    { id: 'st_alkanes', label: 'Alkanes' },
    { id: 'st_alkenes', label: 'Alkenes' },
    { id: 'st_alkynes', label: 'Alkynes' },
    { id: 'st_aromatic', label: 'Aromatic Hydrocarbons' },
  ]},
  { id: 'ch_alcohol', label: 'Alcohols, Phenols and Ethers', children: [
    { id: 'st_alcohol_rxn', label: 'Reactions of Alcohols' },
    { id: 'st_phenol', label: 'Properties of Phenol' },
  ]},
  { id: 'ch_biomolecules', label: 'Biomolecules', children: [
    { id: 'st_carbohydrates', label: 'Carbohydrates' },
    { id: 'st_proteins', label: 'Proteins' },
    { id: 'st_nucleic', label: 'Nucleic Acids' },
  ]},
  { id: 'ch_polymers', label: 'Polymers', children: [
    { id: 'st_addition', label: 'Addition Polymers' },
    { id: 'st_condensation', label: 'Condensation Polymers' },
  ]},
  { id: 'ch_coordination', label: 'Coordination Chemistry', children: [
    { id: 'st_werner', label: "Werner's Theory" },
    { id: 'st_iupac_coord', label: 'IUPAC Naming' },
    { id: 'st_isomerism_coord', label: 'Isomerism in Complexes' },
    { id: 'st_cft', label: 'Crystal Field Theory' },
  ]},
  { id: 'ch_s_block', label: 's-Block and p-Block Elements', children: [
    { id: 'st_alkali', label: 'Alkali Metals' },
    { id: 'st_alkaline', label: 'Alkaline Earth Metals' },
    { id: 'st_group13', label: 'Group 13 (Boron Family)' },
    { id: 'st_group14', label: 'Group 14 (Carbon Family)' },
    { id: 'st_group15', label: 'Group 15 (Nitrogen Family)' },
    { id: 'st_group16', label: 'Group 16 (Oxygen Family)' },
    { id: 'st_group17', label: 'Group 17 (Halogens)' },
    { id: 'st_group18', label: 'Group 18 (Noble Gases)' },
  ]},
  { id: 'ch_d_block', label: 'd and f Block Elements', children: [
    { id: 'st_transition', label: 'Transition Metals' },
    { id: 'st_lanthanide', label: 'Lanthanides' },
    { id: 'st_actinide', label: 'Actinides' },
  ]},
  { id: 'chEnvironmental', label: 'Environmental Chemistry', children: [
    { id: 'st_pollution', label: 'Air and Water Pollution' },
    { id: 'st_green', label: 'Green Chemistry' },
  ]},
];

const MATHEMATICS_CHAPTERS: TaxonomyNode[] = [
  { id: 'ch_sets', label: 'Sets and Relations', children: [
    { id: 'st_sets', label: 'Sets' },
    { id: 'st_relations', label: 'Relations' },
    { id: 'st_functions', label: 'Functions' },
  ]},
  { id: 'ch_limits', label: 'Limits and Continuity', children: [
    { id: 'st_limits', label: 'Limits' },
    { id: 'st_continuity', label: 'Continuity' },
    { id: 'st_differentiability', label: 'Differentiability' },
  ]},
  { id: 'ch_differentiation', label: 'Differentiation', children: [
    { id: 'st_first_principles', label: 'First Principles' },
    { id: 'st_chain_rule', label: 'Chain Rule' },
    { id: 'st_implicit', label: 'Implicit Differentiation' },
    { id: 'st_maxima_minima', label: 'Maxima and Minima' },
  ]},
  { id: 'ch_integrals', label: 'Integration', children: [
    { id: 'st_indefinite', label: 'Indefinite Integrals' },
    { id: 'st_definite', label: 'Definite Integrals' },
    { id: 'st_areas', label: 'Area Under Curves' },
  ]},
  { id: 'ch_differential', label: 'Differential Equations', children: [
    { id: 'st_order_degree', label: 'Order and Degree' },
    { id: 'st_variable_separable', label: 'Variable Separable' },
    { id: 'st_homogeneous', label: 'Homogeneous Equations' },
    { id: 'st_linear', label: 'Linear Differential Equations' },
  ]},
  { id: 'ch_vectors', label: 'Vectors and 3D', children: [
    { id: 'st_vectors_3d', label: '3D Vectors' },
    { id: 'st_lines_3d', label: 'Lines in 3D' },
    { id: 'st_planes', label: 'Planes' },
  ]},
  { id: 'ch_algebra', label: 'Algebra', children: [
    { id: 'st_complex', label: 'Complex Numbers' },
    { id: 'st_quadratic', label: 'Quadratic Equations' },
    { id: 'st_seq_series', label: 'Sequences and Series' },
    { id: 'st_permutations', label: 'Permutations and Combinations' },
    { id: 'st_binomial', label: 'Binomial Theorem' },
    { id: 'st_matrices', label: 'Matrices' },
    { id: 'st_determinants', label: 'Determinants' },
  ]},
  { id: 'ch_trigo', label: 'Trigonometry', children: [
    { id: 'st_ratios', label: 'Trigonometric Ratios' },
    { id: 'st_identities', label: 'Trigonometric Identities' },
    { id: 'st_inverse', label: 'Inverse Trigonometry' },
    { id: 'st Heights Distances', label: 'Heights and Distances' },
  ]},
  { id: 'ch_prob', label: 'Probability and Statistics', children: [
    { id: 'st_prob_basic', label: 'Basic Probability' },
    { id: 'st_bayes', label: "Bayes' Theorem" },
    { id: 'st_random_variable', label: 'Random Variables' },
    { id: 'st_statistics', label: 'Statistics' },
  ]},
  { id: 'ch_coord_geo', label: 'Coordinate Geometry', children: [
    { id: 'st_straight_lines', label: 'Straight Lines' },
    { id: 'st_circles', label: 'Circles' },
    { id: 'st_conics', label: 'Conic Sections' },
    { id: 'st_parabola', label: 'Parabola' },
    { id: 'st_ellipse', label: 'Ellipse' },
    { id: 'st_hyperbola', label: 'Hyperbola' },
  ]},
  { id: 'ch_math_reasoning', label: 'Mathematical Reasoning', children: [
    { id: 'st_statements', label: 'Statements and Logical Connectives' },
    { id: 'st_proof', label: 'Methods of Proof' },
  ]},
];

const BIOLOGY_CHAPTERS: TaxonomyNode[] = [
  { id: 'ch_biodiversity', label: 'The Living World', children: [
    { id: 'st_taxonomy', label: 'Taxonomy and Classification' },
    { id: 'st_biodiversity', label: 'Biodiversity' },
  ]},
  { id: 'ch_plant kingdom', label: 'Plant Kingdom', children: [
    { id: 'st_thallophyta', label: 'Thallophyta' },
    { id: 'st_bryophyta', label: 'Bryophyta' },
    { id: 'st_pteridophyta', label: 'Pteridophyta' },
    { id: 'st_gymnosperm', label: 'Gymnosperms' },
    { id: 'st_angiosperm', label: 'Angiosperms' },
  ]},
  { id: 'ch_animal kingdom', label: 'Animal Kingdom', children: [
    { id: 'st_porifera', label: 'Porifera to Coelenterata' },
    { id: 'st_platyhelminthes', label: 'Platyhelminthes to Aschelminthes' },
    { id: 'st_annelida', label: 'Annelida to Mollusca' },
    { id: 'st_arthropoda', label: 'Arthropoda' },
    { id: 'st_chordata', label: 'Chordata' },
  ]},
  { id: 'ch_cell', label: 'Cell Biology', children: [
    { id: 'st_cell_structure', label: 'Cell Structure and Organelles' },
    { id: 'st_cell_cycle', label: 'Cell Cycle and Division' },
    { id: 'st_biomolecules_ch', label: 'Biomolecules' },
  ]},
  { id: 'ch_plant_physio', label: 'Plant Physiology', children: [
    { id: 'st_photosynthesis', label: 'Photosynthesis' },
    { id: 'st_respiration_plant', label: 'Respiration in Plants' },
    { id: 'st_transpiration', label: 'Transpiration' },
    { id: 'st_mineral_nutrition', label: 'Mineral Nutrition' },
  ]},
  { id: 'ch_animal_physio', label: 'Human Physiology', children: [
    { id: 'st_digestion', label: 'Digestion and Absorption' },
    { id: 'st_breathing', label: 'Breathing and Exchange of Gases' },
    { id: 'st_body_fluids', label: 'Body Fluids and Circulation' },
    { id: 'st_excretion', label: 'Excretory Products' },
    { id: 'st_locomotion', label: 'Locomotion and Movement' },
    { id: 'st_neural', label: 'Neural Control and Coordination' },
    { id: 'st_endocrine', label: 'Chemical Coordination' },
  ]},
  { id: 'ch_genetics', label: 'Genetics', children: [
    { id: 'st_mendel', label: "Mendelian Genetics" },
    { id: 'st_chromosomal', label: 'Chromosomal Basis of Inheritance' },
    { id: 'st_molecular', label: 'Molecular Basis of Inheritance' },
    { id: 'st_dna_replication', label: 'DNA Replication and Expression' },
  ]},
  { id: 'ch_evolution', label: 'Evolution', children: [
    { id: 'st_origin', label: 'Origin of Life' },
    { id: 'st_evidence', label: 'Evidence of Evolution' },
    { id: 'st_mechanism', label: 'Mechanism of Evolution' },
  ]},
  { id: 'ch_ecology', label: 'Ecology', children: [
    { id: 'st_organism', label: 'Organism and Population' },
    { id: 'st_community', label: 'Community Ecology' },
    { id: 'st_ecosystem', label: 'Ecosystem' },
    { id: 'st_biodiversity_ch', label: 'Biodiversity and Conservation' },
  ]},
  { id: 'ch_biotech', label: 'Biotechnology', children: [
    { id: 'st_tools', label: 'Biotechnological Tools' },
    { id: 'st_applications', label: 'Biotechnology Applications' },
  ]},
  { id: 'ch_reproduction', label: 'Reproduction', children: [
    { id: 'st_asexual', label: 'Asexual Reproduction' },
    { id: 'st_plant_repro', label: 'Sexual Reproduction in Plants' },
    { id: 'st_human_repro', label: 'Human Reproduction' },
    { id: 'st_reproductive_health', label: 'Reproductive Health' },
  ]},
];

const ENGLISH_CHAPTERS: TaxonomyNode[] = [
  { id: 'ch_reading', label: 'Reading Comprehension', children: [
    { id: 'st_prose', label: 'Prose Passage' },
    { id: 'st_poetry', label: 'Poetry Comprehension' },
  ]},
  { id: 'ch_writing', label: 'Writing Skills', children: [
    { id: 'st_letter', label: 'Letter Writing' },
    { id: 'st_essay', label: 'Essay Writing' },
    { id: 'st_report', label: 'Report Writing' },
  ]},
  { id: 'ch_grammar', label: 'Grammar', children: [
    { id: 'st_tenses', label: 'Tenses' },
    { id: 'st_voice', label: 'Active and Passive Voice' },
    { id: 'st_narration', label: 'Direct and Indirect Speech' },
    { id: 'st_subject_verb', label: 'Subject-Verb Agreement' },
  ]},
  { id: 'ch_literature', label: 'Literature', children: [
    { id: 'st_prose_ch', label: 'Prose Chapters' },
    { id: 'st_poetry_ch', label: 'Poetry' },
    { id: 'st_drama', label: 'Drama' },
  ]},
];

const HINDI_CHAPTERS: TaxonomyNode[] = [
  { id: 'ch_hindi_gadya', label: 'Gadya (Prose)', children: [
    { id: 'st_hindi_chapter1', label: 'Chapter 1' },
    { id: 'st_hindi_chapter2', label: 'Chapter 2' },
  ]},
  { id: 'ch_hindi_padya', label: 'Padya (Poetry)', children: [
    { id: 'st_hindi_poem1', label: 'Poem 1' },
    { id: 'st_hindi_poem2', label: 'Poem 2' },
  ]},
  { id: 'ch_hindi_grammar', label: 'Hindi Grammar', children: [
    { id: 'st_samas', label: 'Samas' },
    { id: 'st_muhavare', label: 'Muhavare' },
  ]},
];

const CS_CHAPTERS: TaxonomyNode[] = [
  { id: 'ch_computer_fundamentals', label: 'Computer Fundamentals', children: [
    { id: 'st_hardware', label: 'Hardware and Software' },
    { id: 'st_number_systems', label: 'Number Systems' },
  ]},
  { id: 'ch_programming', label: 'Programming', children: [
    { id: 'st_python_basics', label: 'Python Basics' },
    { id: 'st_control_flow', label: 'Control Flow' },
    { id: 'st_functions', label: 'Functions' },
    { id: 'st_data_structures', label: 'Data Structures' },
  ]},
  { id: 'ch networking', label: 'Networking', children: [
    { id: 'st_osi', label: 'OSI Model' },
    { id: 'st_tcp_ip', label: 'TCP/IP' },
  ]},
];

export const EXAM_TAXONOMY: Record<ExamType, Record<string, TaxonomyNode[]>> = {
  neet: {
    Physics: PHYSICS_CHAPTERS,
    Chemistry: CHEMISTRY_CHAPTERS,
    Botany: BIOLOGY_CHAPTERS,
    Zoology: BIOLOGY_CHAPTERS,
  },
  jee_main: {
    Physics: PHYSICS_CHAPTERS,
    Chemistry: CHEMISTRY_CHAPTERS,
    Mathematics: MATHEMATICS_CHAPTERS,
  },
  jee_advanced: {
    Physics: PHYSICS_CHAPTERS,
    Chemistry: CHEMISTRY_CHAPTERS,
    Mathematics: MATHEMATICS_CHAPTERS,
  },
  boards: {
    Physics: PHYSICS_CHAPTERS,
    Chemistry: CHEMISTRY_CHAPTERS,
    Mathematics: MATHEMATICS_CHAPTERS,
    Biology: BIOLOGY_CHAPTERS,
    English: ENGLISH_CHAPTERS,
    Hindi: HINDI_CHAPTERS,
    'Computer Science': CS_CHAPTERS,
  },
  cuet: {
    Physics: PHYSICS_CHAPTERS,
    Chemistry: CHEMISTRY_CHAPTERS,
    Mathematics: MATHEMATICS_CHAPTERS,
    Biology: BIOLOGY_CHAPTERS,
    English: ENGLISH_CHAPTERS,
    'General Test': [],
  },
  olympiad: {
    Physics: PHYSICS_CHAPTERS,
    Chemistry: CHEMISTRY_CHAPTERS,
    Mathematics: MATHEMATICS_CHAPTERS,
    Biology: BIOLOGY_CHAPTERS,
  },
  foundation: {
    Physics: PHYSICS_CHAPTERS,
    Chemistry: CHEMISTRY_CHAPTERS,
    Mathematics: MATHEMATICS_CHAPTERS,
    Biology: BIOLOGY_CHAPTERS,
  },
  custom: {},
};

export function getSubjectsForExam(exam: ExamType): string[] {
  return Object.keys(EXAM_TAXONOMY[exam] || {});
}

export function getChaptersForSubject(exam: ExamType, subject: string): TaxonomyNode[] {
  return EXAM_TAXONOMY[exam]?.[subject] || [];
}

export function getTopicsForChapter(exam: ExamType, subject: string, chapterId: string): TaxonomyNode[] {
  const chapters = getChaptersForSubject(exam, subject);
  const chapter = chapters.find((ch) => ch.id === chapterId);
  return chapter?.children || [];
}
