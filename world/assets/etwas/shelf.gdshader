shader_type spatial;
render_mode specular_disabled;

varying vec3 world_position;

float grain(vec2 p) {
	vec2 cell = floor(p);
	vec2 f = smoothstep(vec2(0.0), vec2(1.0), fract(p));
	vec4 corners = fract(sin(vec4(
		dot(cell, vec2(127.1, 311.7)),
		dot(cell + vec2(1.0, 0.0), vec2(127.1, 311.7)),
		dot(cell + vec2(0.0, 1.0), vec2(127.1, 311.7)),
		dot(cell + vec2(1.0, 1.0), vec2(127.1, 311.7))
	)) * 43758.5453);
	return mix(mix(corners.x, corners.y, f.x), mix(corners.z, corners.w, f.x), f.y);
}

void vertex() {
	world_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = world_position.xz;
	float pigment = grain(p * 10.0) * 0.13 + grain(p * 2.7) * 0.10;
	vec3 color = COLOR.rgb * (0.88 + pigment);
	ALBEDO = OUTPUT_IS_SRGB ? pow(color, vec3(1.0 / 2.2)) : color;
	ROUGHNESS = 0.96;
}
