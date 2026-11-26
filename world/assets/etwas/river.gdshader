shader_type spatial;
render_mode cull_disabled, specular_disabled;

varying vec3 world_pos;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = world_pos.xz;
	float current = p.y - TIME * 0.68;
	float riffle = sin(p.x * 2.9 + current * 4.3 + sin(p.x * 4.5 - current * 1.43) * 0.9);
	float crosswave = sin(p.x * 6.6 - current * 3.6 + sin(current * 5.3) * 0.36);
	float shingle = sin(p.x * 0.9 + sin(current * 1.3) * 0.52) * sin(current * 0.63);
	float foam = smoothstep(0.82, 1.0, riffle) * smoothstep(0.17, 0.91, crosswave);
	float bank = smoothstep(3.46, 4.53, abs(p.x));
	float glance = pow(1.0 - abs(dot(normalize(CAMERA_POSITION_WORLD - world_pos), vec3(0, 1, 0))), 3.0);
	vec3 body = mix(vec3(0.09, 0.24, 0.25), vec3(0.26, 0.48, 0.44), shingle * 0.26 + 0.39 + bank * 0.25);
	ALBEDO = mix(body, vec3(0.58, 0.60, 0.65), glance * 0.57);
	ALBEDO += riffle * crosswave * 0.025 + foam * vec3(0.16, 0.18, 0.15) * (0.26 + bank * 0.74);
	ROUGHNESS = 0.31;
}
