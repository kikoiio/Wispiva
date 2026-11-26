shader_type spatial;
render_mode world_vertex_coords;

varying vec3 wpos;
varying vec3 wnormal;
uniform vec4 tint : source_color = vec4(0.34, 0.33, 0.32, 1.0);
uniform vec4 seam : source_color = vec4(0.18, 0.17, 0.16, 1.0);

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = hash(i);
	float b = hash(i + vec2(1.0, 0.0));
	float c = hash(i + vec2(0.0, 1.0));
	float d = hash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void vertex() {
	wpos = VERTEX;
	wnormal = NORMAL;
}

void fragment() {
	float warp = noise(wpos.xz * 0.02);
	float bed = fract(wpos.y * 0.085 + warp * 1.6);
	float layer = smoothstep(0.0, 0.07, bed);
	float grain = noise(vec2(wpos.x * 0.06 + wpos.z * 0.04, wpos.y * 0.03));
	float crack = smoothstep(0.78, 0.9, noise(wpos.xz * 0.11));
	vec3 rock = tint.rgb * (0.74 + 0.26 * grain);
	rock = mix(seam.rgb, rock, layer);
	rock = mix(rock, seam.rgb, crack * 0.55);
	// A flat top has one bed colour across the whole face. Break that up in XZ only.
	vec3 wn = normalize(wnormal);
	float flatness = smoothstep(0.55, 0.92, abs(wn.y));
	// A vertical face has one normal, so the sun paints it as a single sheet.
	float sway = noise(wpos.xz * 0.045) - 0.5;
	float rise = noise(vec2(wpos.x * 0.03 + wpos.z * 0.02, wpos.y * 0.06)) - 0.5;
	vec3 bent = normalize(wn + vec3(sway, rise * 0.4, sway * 0.65) * (1.0 - flatness) * 0.7);
	NORMAL = normalize((VIEW_MATRIX * vec4(bent, 0.0)).xyz);
	// Broad stains on upright rock. Pad tops skip this and keep the gravel mix below.
	float mass = noise(wpos.xz * 0.012 + vec2(3.0, 9.0));
	float stain = noise(vec2(wpos.x * 0.022 + wpos.z * 0.016, wpos.y * 0.02));
	vec3 face = rock * (0.48 + 0.52 * mass);
	face = mix(face, seam.rgb, smoothstep(0.42, 0.72, stain) * 0.7);
	rock = mix(face, rock, flatness);
	float coarse = noise(wpos.xz * 0.22);
	float pebble = noise(wpos.xz * 1.6);
	float pit = smoothstep(0.72, 0.9, noise(wpos.xz * 0.15 + vec2(4.0, 1.7)));
	vec3 yard = tint.rgb * (0.58 + 0.27 * coarse + 0.15 * pebble);
	yard = mix(yard, seam.rgb, pit * 0.65);
	float dist = length(VERTEX);
	float detail = 1.0 - smoothstep(220.0, 560.0, dist);
	rock = mix(rock, yard, flatness * detail);
	ALBEDO = mix(tint.rgb * 0.9, rock, detail);
	ROUGHNESS = 0.95;
}
