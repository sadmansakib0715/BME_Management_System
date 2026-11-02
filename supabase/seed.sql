-- BME Workflow seed: public reference data only (no people, no rosters).
-- PEOs and POs: https://bme.buet.ac.bd/ug-program-overview/ and https://bme.buet.ac.bd/program-outcomes/
-- Course catalog: BME undergraduate curriculum (2022). Electives may run in either Level-4 term.

insert into public.peos (code, statement) values
('PEO1', 'Be sufficiently skilled to pursue a diverse range of careers, including engineering, research and entrepreneurship.'),
('PEO2', 'Will persistently advance in their respected professional careers through continuous and life-long learning.'),
('PEO3', 'Design, develop, disseminate Biomedical Engineering solutions through research, innovation and application to meet specific healthcare needs of the society with consideration of public health, safety, and welfare, as well as global, cultural, environmental, and economic factors.'),
('PEO4', 'Practice and uphold high ethical and professional standards, and make informed judgments as a leader and/or member of their team, organizations and communities.')
on conflict (code) do update set statement = excluded.statement;

insert into public.pos (code, no, title, statement, k_profiles) values
('PO1', 1, 'Engineering knowledge', 'Apply knowledge of mathematics, science, and engineering to solve complex engineering problems in the broad areas including biomedical instrumentation, imaging, biomaterials, biomechanics, biosignal analysis and informatics.', 'K1–K4'),
('PO2', 2, 'Problem analysis', 'Identify, formulate, research literature and analyze complex biomedical engineering problems reaching substantiated conclusions using first principles of mathematics, natural, medical and engineering sciences.', 'K1–K4'),
('PO3', 3, 'Design/development of solutions', 'Design solutions to complex engineering problems and design systems, components, or processes that meet the needs relevant to biomedical engineering with appropriate considerations to public health and safety, cultural, societal, and environmental considerations.', 'K5'),
('PO4', 4, 'Investigation', 'Conduct investigations of complex problems using research-based knowledge and research methods including design of experiments, clinical needs assessment, analysis and interpretation of data, and synthesis of information to provide valid conclusions.', 'K8'),
('PO5', 5, 'Modern tool usage', 'Use techniques, skills, and modern engineering tools to solve complex and practical engineering problems related to biomedical engineering with understanding of the limitations.', 'K6'),
('PO6', 6, 'The engineer and society', 'Apply reasoning to assess societal, health, safety, legal and cultural issues and the consequent responsibilities relevant to professional engineering practice and solutions to complex engineering problems.', 'K7'),
('PO7', 7, 'Environment and sustainability', 'Understand and evaluate the sustainability and impact of professional engineering work in the solution of complex engineering problems in societal and environmental contexts.', 'K7'),
('PO8', 8, 'Ethics', 'Apply ethical principles and commit to professional ethics and responsibilities and norms of engineering practice.', 'K7'),
('PO9', 9, 'Individual work and teamwork', 'Function effectively as an individual, and as a member or leader in diverse teams and in multi-disciplinary settings.', null),
('PO10', 10, 'Communication', 'Communicate effectively on complex engineering activities with the biomedical engineering and other inter-disciplinary communities and with society at large, such as being able to comprehend and write effective reports and design documentation, make effective presentations, and give and receive clear instructions.', null),
('PO11', 11, 'Project management and finance', 'Demonstrate knowledge and understanding of engineering management principles and economic decision-making and apply these to one''s own work, as a member and leader in a team, to manage projects and in multidisciplinary environments.', null),
('PO12', 12, 'Life-long learning', 'Recognize the need for, and ability to engage in life-long learning and know contemporary aspects related to the field of biomedical engineering.', null)
on conflict (code) do update set statement = excluded.statement, title = excluded.title, k_profiles = excluded.k_profiles;

insert into public.courses (code, title, course_type, level, term_no, credits, contact_hours, elective_group) values
('BME 101','Introduction to Biomedical Engineering','theory',1,1,3,3,null),
('BME 103','Introduction to Living Cells and Human Anatomy','theory',1,2,3,3,null),
('BME 150','Computer Aided Design in Biomedical Engineering Sessional','sessional',1,2,1.5,3,null),
('BME 201','Biomechanics','theory',2,1,3,3,null),
('BME 202','Biomechanics Sessional','sessional',2,1,0.75,1.5,null),
('BME 203','Human Physiology','theory',2,1,3,3,null),
('BME 204','Human Physiology Sessional','sessional',2,1,1.5,3,null),
('BME 205','Biofluid Mechanics and Heat Transfer','theory',2,2,3,3,null),
('BME 206','Biofluid Mechanics and Heat Transfer Sessional','sessional',2,2,1.5,3,null),
('BME 207','Biomaterials','theory',2,2,3,3,null),
('BME 208','Biomaterials Sessional','sessional',2,2,1.5,3,null),
('BME 210','Numerical Techniques Sessional','sessional',2,2,0.75,1.5,null),
('BME 211','Bioelectricity','theory',2,2,3,3,null),
('BME 300','Biomedical Engineering Design - I','design',3,1,1.5,3,null),
('BME 303','Biomedical Instrumentation and Measurements','theory',3,1,3,3,null),
('BME 304','Biomedical Instrumentation and Measurements Sessional','sessional',3,1,1.5,3,null),
('BME 305','Biomedical Control Systems','theory',3,2,3,3,null),
('BME 306','Biomedical Control Systems Sessional','sessional',3,2,1.5,3,null),
('BME 307','Biomedical Transport Fundamentals','theory',3,2,3,3,null),
('BME 309','Quantitative Physiology','theory',3,1,3,3,null),
('BME 310','Communicating Protocols for Biomedical Instruments Sessional','sessional',3,1,1.5,3,null),
('BME 311','Biomedical Signals and Systems','theory',3,1,3,3,null),
('BME 313','Molecular Biology and Immunology','theory',3,2,3,3,null),
('BME 317','Biochemistry for Biomedical Engineers','theory',3,2,3,3,null),
('BME 320','Industrial Attachment','attachment',3,2,1,null,null),
('BME 350','Biomedical Engineering Design - II','design',3,2,1.5,3,null),
('BME 400','Project and Thesis','thesis',4,null,3,6,null),
('BME 403','Medical Imaging','theory',4,1,3,3,null),
('BME 404','Medical Imaging Sessional','sessional',4,1,1.5,3,null),
('BME 405','Healthcare System Management','theory',4,2,3,3,null),
('BME 409','Tissue Engineering and Regenerative Medicine','theory',4,null,3,3,'I'),
('BME 411','BioMEMS','theory',4,null,3,3,'I'),
('BME 413','BioMicro and Nanotechnology','theory',4,null,3,3,'I'),
('BME 415','Bionanomaterials','theory',4,null,3,3,'I'),
('BME 417','Advanced Biofluid Mechanics','theory',4,null,3,3,'I'),
('BME 419','Implantable Systems','theory',4,null,3,3,'I'),
('BME 421','Rehabilitation Engineering','theory',4,null,3,3,'I'),
('BME 423','Human Assist Devices','theory',4,null,3,3,'I'),
('BME 425','Drug Delivery','theory',4,null,3,3,'I'),
('BME 427','Introduction to Medical Robotics','theory',4,null,3,3,'I'),
('BME 431','Telemedicine Systems','theory',4,null,3,3,'II'),
('BME 433','Biosensors','theory',4,null,3,3,'II'),
('BME 435','Introduction of Biophysics of Molecules and Cells','theory',4,null,3,3,'II'),
('BME 437','Engineering Optics for Medical Application','theory',4,null,3,3,'II'),
('BME 439','Neural Systems Modeling','theory',4,null,3,3,'II'),
('BME 441','Neural Engineering','theory',4,null,3,3,'II'),
('BME 443','Magnetic Resonance Imaging','theory',4,null,3,3,'II'),
('BME 445','Biomedical Signal Processing','theory',4,null,3,3,'II'),
('BME 447','Clinical Engineering','theory',4,2,3,3,null),
('BME 449','Machine Learning for Biomedical Engineers','theory',4,null,3,3,'II'),
('BME 471','Pharmaceutical Engineering','theory',4,null,3,3,'I')
on conflict (code) do nothing;
