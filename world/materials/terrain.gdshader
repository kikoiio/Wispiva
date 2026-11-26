shader_type spatial;
render_mode world_vertex_coords;

varying vec3 wpos;
uniform bool road = false;
uniform vec4 town = vec4(-30.0, 170.0, -90.0, 90.0);
uniform vec4 grass_a : source_color = vec4(0.30, 0.42, 0.20, 1.0);
uniform vec4 grass_b : source_color = vec4(0.40, 0.50, 0.24, 1.0);
uniform vec4 grass_dry : source_color = vec4(0.46, 0.44, 0.22, 1.0);
uniform vec4 dirt_a : source_color = vec4(0.40, 0.32, 0.22, 1.0);
uniform vec4 dirt_b : source_color = vec4(0.52, 0.42, 0.28, 1.0);
uniform vec4 cobble_a : source_color = vec4(0.40, 0.37, 0.33, 1.0);
uniform vec4 cobble_b : source_color = vec4(0.55, 0.51, 0.45, 1.0);
uniform vec4 cobble_joint : source_color = vec4(0.32, 0.30, 0.27, 1.0);

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

float band(float v, float lo, float hi, float edge) {
	return smoothstep(lo - edge, lo + edge, v) * (1.0 - smoothstep(hi - edge, hi + edge, v));
}

void vertex() {
	wpos = VERTEX;
}

void fragment() {
	vec2 xz = vec2(wpos.x, wpos.z);
	float in_town = band(xz.x, town.x, town.y, 2.5) * band(xz.y, town.z, town.w, 2.5);
	vec2 warped = xz + vec2(noise(xz * 0.17), noise(xz * 0.17 + 8.0)) * 0.45;
	float row = floor(warped.y * 0.72);
	vec2 g = vec2(warped.x * 0.72 + mod(row, 2.0) * 0.5, warped.y * 0.72);
	vec2 cell = floor(g);
	vec2 f = fract(g);
	float mortar = smoothstep(0.0, 0.07, f.x) * smoothstep(0.0, 0.07, f.y);
	float n = hash(cell);
	vec3 cob_near = mix(cobble_joint.rgb, mix(cobble_a.rgb, cobble_b.rgb, n), mortar);
	float dist = length(VERTEX);
	float detail = 1.0 - smoothstep(90.0, 200.0, dist);
	vec3 cob = mix(mix(cobble_a.rgb, cobble_b.rgb, 0.5), cob_near, detail);
	float g1 = noise(xz * 0.04);
	float g2 = noise(xz * 0.16);
	vec3 grass = mix(grass_a.rgb, grass_b.rgb, g1);
	grass = mix(grass, grass_dry.rgb, smoothstep(0.55, 0.9, g2) * 0.4);
	float d1 = noise(xz * 0.09);
	vec3 dirt = mix(dirt_a.rgb, dirt_b.rgb, d1);
	vec3 outside = road ? dirt : grass;
	vec3 inside = road ? mix(cob, dirt, 0.35) : cob;
	ALBEDO = mix(outside, inside, in_town);
	ROUGHNESS = mix(0.97, 0.86, in_town);
}
