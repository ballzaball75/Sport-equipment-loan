-- Sample data. Run after schema.sql (once, on an empty DB).
INSERT INTO dbo.sports (name) VALUES
 (N'Football'), (N'Futsal'), (N'Basketball'), (N'Volleyball'), (N'Badminton'),
 (N'Sepak Takraw'), (N'Table Tennis'), (N'Cricket'), (N'Tennis'), (N'Muay Thai');

INSERT INTO dbo.equipment (sport_id, name, total_qty)
SELECT s.id, v.name, v.qty FROM (VALUES
 (N'Football',     N'Football size 5', 10),
 (N'Football',     N'Training cones (set of 20)', 6),
 (N'Futsal',       N'Futsal ball', 8),
 (N'Basketball',   N'Basketball size 7', 8),
 (N'Volleyball',   N'Volleyball', 8),
 (N'Volleyball',   N'Portable volleyball net', 2),
 (N'Badminton',    N'Badminton racket', 12),
 (N'Badminton',    N'Shuttlecock tube (12 pcs)', 20),
 (N'Badminton',    N'Portable badminton net', 3),
 (N'Sepak Takraw', N'Takraw ball (rattan)', 10),
 (N'Sepak Takraw', N'Takraw net', 2),
 (N'Table Tennis', N'Table tennis paddle', 10),
 (N'Table Tennis', N'Table tennis balls (box of 6)', 15),
 (N'Cricket',      N'Cricket bat', 4),
 (N'Cricket',      N'Cricket ball', 6),
 (N'Tennis',       N'Tennis racket', 6),
 (N'Tennis',       N'Tennis balls (can of 3)', 10),
 (N'Muay Thai',    N'Boxing gloves 12 oz (pair)', 6),
 (N'Muay Thai',    N'Kick pads (pair)', 4)
) AS v(sport, name, qty)
JOIN dbo.sports s ON s.name = v.sport;
