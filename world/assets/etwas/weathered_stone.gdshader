shader_type spatial;
render_mode specular_disabled;

uniform vec4 pigment : source_color = vec4(0.46, 0.42, 0.39, 1.0);
varying vec3 world_pos;

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = smoothstep(vec2(0.0), vec2(1.0), fract(p));
	vec4 h = fract(sin(vec4(dot(i, vec2(127.1, 311.7)), dot(i + vec2(1, 0), vec2(127.1, 311.7)),
		dot(i + vec2(0, 1), vec2(127.1, 311.7)), dot(i + 1.0, vec2(127.1, 311.7)))) * 43758.5453);
	return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
}

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 along = vec2(world_pos.x + world_pos.z * 0.86, world_pos.y);
	float mottling = noise(along * 2.1 + world_pos.xz * 0.36);
	float strata = noise(along * vec2(1.03, 16.0) + mottling * 0.45);
	float flecks = noise((world_pos.xz * 0.71 + along) * 55.0);
	float stain = smoothstep(0.52, 0.91, noise(along * vec2(2.42, 0.81) + 11.6));
	vec3 dusty = pigment.rgb * (0.84 + mottling * 0.13 + strata * 0.13 + flecks * 0.07);
	ALBEDO = mix(dusty, dusty * vec3(0.78, 0.85, 0.79), stain * 0.72);
	ROUGHNESS = 0.91 + flecks * 0.06;
}
